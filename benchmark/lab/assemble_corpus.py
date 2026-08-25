"""Assembles the corpus cleanfeed-ptbr-cells-v1 from candidate pools into the canonical
BenchmarkRecord **v3** shape that `ingest` + `validate` accept.

Emits (into --out-dir):
  records.jsonl                    the canonical records (human/ai/mixed)
  cluster-report.json              cluster count + size distribution + largest
                                   cluster, per axis and per slice (feeds E3)
  private/review-ledger.jsonl      one {recordId,reviewState,...} per record — the
                                   HONEST review state, never a fabricated concordance
  private/label-evidence.jsonl     the entries every human labelEvidenceRef resolves
                                   against, one per SOURCE registration
  governance-inputs.json           sourceIds + held-out families + licenses, for
                                   build_governance.ts to mint the digest-bound
                                   source-manifest.json and template manifest.json
  artifact-gate.json               the A4 pre-training anti-artifact measurement: one
                                   entry per generator family, with its contamination
                                   fraction and its verdict (see artifact_gate.py). The
                                   ONE output written even when the run is refused, and
                                   the only one: it is the diagnosis of the refusal

WHAT CHANGED IN v3, AND WHY (C2). The v2 assembler wrote a fresh identifier per
record on five of the grouping axes, so the blocked split had nothing to find, the
clustered bootstrap resampled i.i.d. over singletons, and the near-duplicate axis
could not name a cluster. The long note above `UnmappableLane` states the defect and
its three measured consequences. Now:

  * every axis carries a STATE — `known` with an identity, `notApplicable` with a
    written reason, or `unknown` with a written reason and the cost of the record's
    eligibility (R6). Nothing is ever substituted;
  * the identities are the ones the sources have: the Wikipedia PAGE, the Carolina
    MEMBER FILE, the extraction RUN, the generation BATCH, the human SEED, the prompt
    TEMPLATE, the LANE. The Stack Overflow THREAD and the B2W PRODUCT are still named,
    in `A1_BLOCKED_DOMAIN_SOURCES` and `OUT_OF_FRAME_DOMAIN_SOURCES`, because those two
    bases are OUTSIDE the declared frame — not because they have no identity;
  * where a person identifier exists it is an HMAC pseudonym keyed by C3's keyring,
    never a bare digest, and the extractor fails closed without it. No cell of the
    declared frame yields one: a Wikipedia lead section has no single author and the
    Carolina extractor never reads TEI header names;
  * a human row states the basis of its `human` label — which date field, what value,
    against which cutoff, out of which snapshot — instead of asserting it;
  * a row the v3 contract cannot express is DROPPED AND COUNTED, never patched. v2
    accepted generated rows with no lane, no template digest and no effort, and human
    rows with no date evidence; those counts are printed, and they are the size of
    what has to be re-extracted or regenerated.

Design otherwise unchanged from the assembly map (memory:
cleanfeed-canonical-assembly):
  * OMIT normalizedTextSha256 (ingest recomputes + fills).
  * Pseudonyms /^[A-Za-z0-9_-]+$/ everywhere ids/groups live; families slugged.
  * label cross-rules: human->no generation; ai->generation; mixed->mixture
    (fractions sum to 1 at full float precision) + derivationRoot != id.
  * humanSourceType = the QUOTA CELL the declared frame has a source for.
    hardNegativeFamily tagged heuristically so all 6 required families are
    present on human records.
  * createdAt assigns a train/dev/cal-A/cal-B/test BLOCK (45/5/10/20/20 per class); held-out AI
    generator families are forced entirely into the test block (latest time),
    as the split requires them after the test cut.

Usage:
  python assemble_corpus.py --out-dir ../out/rebuild-v3/C2 [--sample 120]
    [--candidates-dir <pools>]

NEVER point --out-dir at benchmark/data/corpus-build: that is the sealed artifact of
the REPROVED run and §7 of the plan puts it in "Descarte", so overwriting it would
destroy the evidence the diagnosis rests on.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from pathlib import Path

import artifact_gate
import generate_ai
import group_axes
import near_dupes
import pii_screen

CAND = Path(__file__).resolve().parent.parent / "data" / "candidates"
DATASET = Path(__file__).resolve().parent.parent / "data" / "dataset"

# The frozen pre-registration, READ and never retyped. It is the single authority for
# the generation lanes and for the human collection targets, and a copy on this side
# would be a second authority that can disagree with the sealed one. It has to be the
# LIVE file: the abandoned rebuild-v3-policy pair left `EVALUATOR_FILES`, so a byte
# changed there no longer moves the `evaluatorDigest`, and reading it would put an
# unwatched authority in charge of what a sealed corpus contains.
POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"

# The cutoff every human label in this corpus rests on, as the ISO instant the
# record's labelEvidenceRef carries. Same value as common.CHATGPT_CUTOFF; spelled
# here because the record needs the string form and the extractor needs the datetime.
CUTOFF_ISO = "2022-11-30T00:00:00+00:00"

# provenance.sourceId -> the frozen snapshot token it was extracted from
# (benchmark/preregistration-v4.json humanSources.snapshots). The fallback for a
# candidate whose own meta does not carry the snapshot, which is every pool written
# before C2. It maps SOURCE to SNAPSHOT and nothing else: it does not record which
# concrete dump version, because that is a fact only the extractor saw and D1 is
# what registers it.
#
# The bases outside the declared frame are NOT here, and their absence is a refusal
# rather than a gap: `label_evidence` falls back to this map, so an entry for
# `pt-stackoverflow`, `b2w-reviews01` or `carolina` would date a row against a snapshot
# the frozen policy does not stock (the first is in `humanSources.blockedSnapshots`,
# the other two are out of frame). They stay named, with the reason, in the two dicts
# below.
SOURCE_SNAPSHOT = {
    "src_wikipedia_pt": "ptwiki",
}

# Block timestamps drive the temporal split, one per partition in temporal order
# (train < dev < cal-A < cal-B < test). The splitter finds its four cuts between these
# blocks, so the spacing only has to be strictly increasing.
BLOCK_TIME = {
    "train": 1_000_000,
    "dev": 2_000_000,
    "cal-A": 3_000_000,
    "cal-B": 4_000_000,
    "test": 5_000_000,
}
# The 45/5/10/20/20 blocks per class, and the ONLY place they are written down: a second
# spelling of one frozen decision could be edited without the first moving, so
# `assign_partitions` reads this dict rather than repeating the fractions inline.
# `test` carries no fraction because it is the REMAINDER — deriving it by rounding too
# would let the five blocks fail to sum to the class size.
CLASS_FRACTIONS = {"train": 0.45, "dev": 0.05, "cal-A": 0.1, "cal-B": 0.2}

# As cinco frações COM NOME, na ordem temporal, e a ÚNICA escrita delas. `test` é o resto,
# e três construções à mão de `dict(CLASS_FRACTIONS) | {"test": ...}` são três lugares onde
# o resto pode ser derivado por arredondamento e as cinco deixarem de somar 1.
BLOCK_FRACTIONS: dict[str, float] = {
    **CLASS_FRACTIONS,
    "test": round(1.0 - sum(CLASS_FRACTIONS.values()), 10),
}

# Mirrors `CLASS_TOLERANCE` in benchmark/split.ts, which is what the audit compares against.
# Absolute, not relative to the target: two points is forty percent of `dev`'s 5%, so a `dev`
# holding 3% or 7% of a class is legal, and a guard stricter than this refuses corpora the
# splitter accepts. `test_extractors.py` compares it against the TypeScript constant.
CLASS_TOLERANCE = 0.02

# O epsilon que toda comparacao de tolerancia soma, espelhando `CLASS_TOLERANCE_EPSILON` em
# benchmark/split.ts. A tolerancia e INCLUSIVA — 3% e 7% num `dev` sao legais pelo contrato — e
# float binario nao representa a borda: `abs(0.03 - 0.05)` da 0.020000000000000004, maior que
# 0.02. Comparar float cru recusa exactamente os dois valores que o contrato admite.
CLASS_TOLERANCE_EPSILON = 1e-9


def within_class_tolerance(fracao: float, alvo: float) -> bool:
    """`|fracao - alvo| <= CLASS_TOLERANCE`, com a borda INCLUIDA."""
    return abs(fracao - alvo) <= CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON


# --- O PLANO DE ILHAS da classe gerada --------------------------------------------------
#
# Com `promptTemplate` na uniao, um componente da classe gerada e o fecho transitivo sobre
# os templates. Um slate que roda model x effort sobre os MESMOS prompts funde a classe
# inteira num componente, e `UnsplittableCorpus` recusa — depois de a cota estar gasta. O
# plano existe para a recusa vir ANTES, e mora no arquivo que ja e dono da aritmetica das
# cinco fracoes porque e a mesma aritmetica que decide a granularidade.
#
# A ILHA NAO E UM CONJUNTO DE TEMPLATES: e um BLOCO DE MATERIAL HUMANO, e toda linha gerada
# ou mista semeada nesse bloco pertence a ela. TRES coisas sao particionadas pelo MESMO
# bloco, e medido, nenhuma das tres e dispensavel — um corpo em que cada template pertence
# a uma corrida mas os pais mistos estao espalhados colapsa de 20 componentes para 1, porque
# `derivationRoot` e uniao POR VALOR e `humanSeed` e linhagem, entao uma linha mista cujo pai
# humano semeia uma linha ai de OUTRA ilha funde as duas:
#   (i)   os templates de geracao da classe ai;
#   (ii)  o bloco de sementes humanas que a corrida empareja;
#   (iii) o template de mistura e os pais das linhas mistas da ilha.
#
# `generatorVersion` NAO e um dos eixos, e a razao e medida: ele nao esta na uniao (o
# argumento esta no comentario de `SPLIT_GROUP_KEYS`), e nem poderia ser particionado aqui —
# a identidade de versao de uma linha e o id do modelo, entao vinte ilhas pediriam vinte ids
# distintos, e os pools montados carregam cinco. O que se perde e a CO-LOCACAO de versao: duas linhas da mesma versao de gerador
# podem cair em particoes diferentes, e a perna de novidade de gerador e a reserva OOD por
# familia (`OOD_RESERVED_FAMILIES`), que e outro mecanismo.
#
# ILHAS = 20 e uma escolha DERIVADA e nao um gosto, e o que a deriva esta em
# `assert_island_plan_realizes_the_five_fractions`: 15 ilhas atribuem e erram `cal-A` em
# 6,65 % contra 10 %, 16 e 18 passam a geometria e nao atribuem, e 20 realizam
# 45/5/10/20/20 exactamente nas TRES classes. Os totais por classe sao os de
# `RELEASE_CORPUS_POLICY.counts` (benchmark/dataset-manifest.ts) e a igualdade e pinada por
# teste, porque este arquivo nao le arquivo nenhum no import — `generate_ai` importa daqui.
ISLAND_COUNT = 20
ISLAND_PLAN_CLASS_LINES: dict[str, int] = {"human": 4000, "ai": 4000, "mixed": 2000}
# As ilhas cuja `generatorFamily` a moldura RESERVA. Tres, e nao quatro, e o limite e do
# PLANO e nao da guarda: `_plano_de_blocos` assenta todo componente reservado INTEIRO em
# `test`, cujo alvo e o resto (800 linhas ai, 800 humanas, 400 mistas), entao QUATRO ilhas de
# 200 cabem exactamente e deixam o bloco cego INTEIRAMENTE de reserva — sem populacao para a
# hipotese de recall sobre familia VISTA, que o mesmo bloco carrega. `ReserveFillsTheBlindBlock`
# so recusa acima do alvo, entao nao impoe isto: quem impoe e
# `assert_island_plan_leaves_core_in_the_blind_block`, e o residuo e que a guarda existente
# aprovaria quatro.
RESERVED_ISLANDS: tuple[str, ...] = ("ilha_17", "ilha_18", "ilha_19")

# As tres operacoes de mistura, e a ORDEM importa: as fronteiras dos clusters de
# `_island_component` derivam dela. Grafia ASCII, como as identidades do resto do plano.
MIX_OPERATIONS: tuple[str, ...] = ("substituicao", "insercao", "concatenacao")

# Os sete niveis INTERIORES da curva de cobertura de IA, em pontos percentuais de
# `aiFraction` alvo. Os extremos nao sao linhas mistas: 0 % e o texto do pai palavra por
# palavra e colide com ele por `normalizedTextSha256`, e um documento integralmente de IA
# nao tem origem dividida — `mixture` e proibida fora de `mixed` por esse motivo.
MIX_LEVELS: tuple[int, ...] = (15, 25, 40, 50, 60, 75, 90)

# A celula que sai, e a razao e VIES DE COMPRIMENTO e nao impossibilidade: inserir uma
# secao que leve o documento ao nivel mais baixo preserva o pai inteiro, e o par pai/mista
# fica perto do limite de poda de `near_dupes` (0,82 sobre shingles de 5 TOKENS) — de que
# lado depende do comprimento do pai. Medido sobre a geometria que o pino modela (uma secao
# contigua no MEIO do pai, tokens todos distintos): o primeiro cruzamento do limite e em 218
# tokens e o sinal so fica monotono a partir de 232 — entre os dois alterna, porque o enxerto
# e arredondado para token inteiro —, e em pai curto o par fica abaixo do limite. Logo a
# celula existiria so em documento pequeno, e a operacao viraria proxy do comprimento, que e
# eixo de fatia diagnostica declarado — pior que celula vazia, porque ninguem le o vies. Acima
# da fronteira a poda derruba o pai humano (a prioridade e ai > mixed > human) e com ele a
# ponte da ilha. A celula SEGUINTE da mesma operacao fica sempre abaixo de 0,75, que e o
# supremo da razao nessa geometria — o comprimento o aproxima por baixo e nunca o alcanca
# (0,7494 em 10.000 tokens) —, e 0,75 esta abaixo do limite de poda.
MIX_CELL_EXCLUDED: tuple[tuple[str, int], ...] = (("insercao", 15),)


def mix_cells() -> tuple[tuple[str, int], ...]:
    """As celulas operacao x nivel que uma ilha compra, sem as inalcancaveis.

    Ordem OPERACAO-maior, e ela e o contrato: as fronteiras dos clusters de
    `_island_component` derivam desta sequencia.
    """
    return tuple(
        (operacao, nivel)
        for operacao in MIX_OPERATIONS
        for nivel in MIX_LEVELS
        if (operacao, nivel) not in MIX_CELL_EXCLUDED
    )


def mix_cell_allocation(mistas: int) -> tuple[tuple[str, int], ...]:
    """A celula de CADA uma das `mistas` linhas de uma ilha, indexada pela posicao.

    A aritmetica e a autoridade e a funcao e TOTAL sobre qualquer cota de ilha: as linhas
    dividem-se igualmente entre as celulas e o resto vai para as primeiras, na ordem de
    `mix_cells`, para a soma fechar exactamente com a cota. Digitar 35/30/35 poria a
    alocacao em dois lugares que podem divergir sem nada reprovar — e amarraria a funcao ao
    plano de 20 ilhas, que e uma escolha derivada e nao um dado.

    Os blocos sao CONTIGUOS por indice, e e essa a forma que a geometria compra: blocos
    contiguos dao as duas paridades de pai a todo cluster de operacao, enquanto
    `i % len(MIX_OPERATIONS)` daria 34/33/33 — uma alocacao que o plano nao compra.

    Devolve a celula POR LINHA e nao o total por operacao porque os dois leitores precisam
    de coisas diferentes da mesma aritmetica: `_island_component` precisa da operacao da
    linha `i` para lhe dar a identidade de template do slot, e o laco de `make_mixed.py`
    precisa da celula inteira — operacao E nivel — para compor o pedido. Duas expansoes da
    mesma conta podiam divergir sem nada reprovar, e o que se estampa na linha deixaria de
    ser o que o plano modela.

    No plano de producao (20 ilhas, 100 mistas por ilha) isto realiza 20 celulas de 5
    linhas e 35/30/35 por operacao, e esses numeros estao pinados por teste.
    """
    celulas = mix_cells()
    saida: list[tuple[str, int]] = []
    for indice, celula in enumerate(celulas):
        quantas = mistas // len(celulas) + (1 if indice < mistas % len(celulas) else 0)
        saida.extend([celula] * quantas)
    return tuple(saida)


def mix_lines_by_operation(mistas: int) -> dict[str, int]:
    """Linhas por operacao numa ilha, CONTADAS sobre a alocacao por celula.

    Contadas e nao calculadas de novo: a conta vive em `mix_cell_allocation`, e um segundo
    calculo aqui seria a divergencia que essa funcao existe para impedir. Toda operacao
    aparece na saida, inclusive com zero, porque quem le itera o vocabulario.
    """
    por_operacao = dict.fromkeys(MIX_OPERATIONS, 0)
    for operacao, _nivel in mix_cell_allocation(mistas):
        por_operacao[operacao] += 1
    return por_operacao


def _island(indice: int) -> dict:
    """Uma ilha do plano: o nome, os templates, o bloco de semente e os de mistura.

    Os templates de mistura sao um por OPERACAO, chaveados por ela. Um slot unico por ilha
    confundiria a operacao com a ilha: `dev` recebe uma ilha so, e a ilha de nucleo do bloco
    cego tambem, entao as duas carregariam UMA operacao — cegueira estrutural no ponto de
    falha que a curva existe para medir. E a chave e a operacao, nao a posicao, porque duas
    identidades da mesma operacao ficam assim IRREPRESENTAVEIS, e o dono de uma colisao
    consegue nomear a operacao na recusa.

    `templates` e `mixingTemplates` sao SLOTS e nao receitas do slate de hoje: o slate e
    decisao de coleta do operador e este arquivo nao a toma. O que a guarda impoe e a FORMA —
    template em uma ilha so — e `generate_ai.island_plan` recusa uma ilha cujos templates o
    slate nao serve. Medido em 2026-08-22: `RECIPES` declara **quarenta** nomes, o plano pede
    quarenta, e toda ilha e servida — entao essa recusa NAO barra corrida alguma hoje. Ela
    fica como forma, e o que barra a corrida e a chave do provedor.
    """
    return {
        "island": f"ilha_{indice:02d}",
        "templates": (f"pt-ilha-{indice:02d}-a", f"pt-ilha-{indice:02d}-b"),
        "mixingTemplates": {
            operacao: f"mix-{operacao}-ilha-{indice:02d}"
            for operacao in MIX_OPERATIONS
        },
        "seedBlock": indice,
        "lines": {
            classe: total // ISLAND_COUNT
            for classe, total in ISLAND_PLAN_CLASS_LINES.items()
        },
        "reserved": f"ilha_{indice:02d}" in RESERVED_ISLANDS,
    }


ISLAND_PLAN: tuple[dict, ...] = tuple(_island(i) for i in range(ISLAND_COUNT))


class IslandPlanRefused(RuntimeError):
    """Um plano de ilhas que a geracao nao pode rodar. Levantado ANTES de gastar cota."""

# domainSource (candidate) -> humanSourceType, which IS the quota cell: the population
# the release publishes one FPR ceiling for, over its own denominator of human
# negatives. ONE cell, one material — encyclopedic text, Wikipedia pt.
#
# The VOCABULARY is `preRegistration.quotaAxis.cells`, and the choice is load-bearing
# rather than cosmetic: the gates read this very field (`CELL_FPR_AXIS` in
# benchmark/gates.ts) and name the hypothesis they decide `fpr-<value>`, so a value
# outside the cell list produces a hypothesis the frozen `multiplicity.primaryFamily`
# does not carry, leaves the one it does carry undecided, and counts zero lines in the
# cell of the composition gate. Since the frame amendment `humanCoreStrata` holds the
# SAME single string, so there is no second vocabulary left to pick the wrong one from.
REGISTER = {
    "ptwiki_lead": "ptwiki",
}
def quota_cells_of(register: dict[str, str]) -> tuple[str, ...]:
    """The cells a register writes, in name order and without repetition.

    A named function and not an inline expression because it is the DENOMINATOR of the
    per-cell collection quota, and with ONE cell in frame the expression is degenerate:
    every wrong derivation — including a hand-typed one-element tuple — agrees with the
    right one. Exercised at more than one cell, it stops agreeing.
    """
    return tuple(sorted(set(register.values())))


# The cells, in name order. Derived rather than retyped because it is the DENOMINATOR
# of the per-cell collection quota: a second cell added to the register above without
# this list moving would keep dividing the whole total into the one cell.
QUOTA_CELLS: tuple[str, ...] = quota_cells_of(REGISTER)
# The human source A1 REFUSED, kept with its name and its reason, mirroring
# `A1_BLOCKED_HUMAN_SOURCES` (benchmark/source-manifest.ts). The condition is legal and
# satisfiable — a verifiable record of how and when the dump was acquired, plus a
# disposition of the 2024 access term that excludes LLM-training projects — so the
# entry has to survive in order to be refused BY NAME (F0-6). A source that leaves by
# deletion is a source the pipeline goes silent on: it would read a pool of it, find no
# cell, and drop the rows with no reason to report.
A1_BLOCKED_DOMAIN_SOURCES = {
    "ptso_qa": (
        "src_ptso is blocked by access terms: the 2024 term excludes LLM-training "
        "projects and no verifiable record of the dump's acquisition exists"
    ),
}
# Domain sources whose route and licence are admissible and that have NO CELL. A third
# fact, held apart from the two above for the reason `SOURCE_OUT_OF_DECLARED_FRAME`
# exists on the sealed side: "refused on a legal condition" and "outside the sampling
# frame" are different things to act on, and merging them erases which one applies.
#
# The three Carolina typologies the frame USED to draw on are here since the frame
# amendment, each with what was measured over the package rather than a judgment about
# the register: the material is single-institution, declares no author, and offers no
# basis for counting independent units between one and tens of thousands.
OUT_OF_FRAME_DOMAIN_SOURCES = {
    "b2w_reviews": (
        "product review is not the cell the claim is published over, so no cell can "
        "carry its quota — the route and the licence stay admissible"
    ),
    "carolina_judicial_branch": (
        "single institution: 38.187 documents over 5 hosts, all *.stf.jus.br, and ZERO "
        "declare an author, so 'FPR in judicial text' would be read off one court and "
        "the count of independent units is undecidable between 1 and 38.187"
    ),
    "carolina_university_domains": (
        "single institution: 26.409 documents from jornal.usp.br alone, ZERO with an "
        "author, so the population would be one newspaper and not university-domain "
        "text"
    ),
    "carolina_social_media": (
        "single platform: 3.294 documents from wattpad.com alone, and its 104 authors "
        "are below the 300-unit floor — fiction posted to one site is also not the "
        "social-media register the cell claimed"
    ),
    "carolina_legislative_branch": (
        "the frame drew on the judicial typology alone while it drew on Carolina at "
        "all; the legislative one is a different population and outside the frame"
    ),
    "carolina_public_domain_works": (
        "public-domain works are literary and historical texts, which the declared "
        "cell does not describe, and the typology holds 26 documents"
    ),
    "carolina_wikis": (
        "outside the sampling frame, and the encyclopedic cell is served by the "
        "Wikipedia dump directly: taking both bases would make cross-source "
        "near-duplicates of the same articles"
    ),
    "carolina_datasets_and_other_corpora": (
        "a compilation of other corpora is not a register: the material's provenance "
        "is whatever each compiled base was, and it overlaps the other typologies"
    ),
}
# domainSource -> provenance.sourceId, which must appear in the source-manifest
# sources[]. Keyed exactly like REGISTER — the two are pinned key-for-key by test,
# because a candidate admitted by one and unknown to the other would be a row with a
# cell and no provenance.
#
# The LICENCE is deliberately not here. Carolina declares availability per TEI
# document, so the base has no single licence and the extractor reads one per document;
# a map from the stratum to a licence overwrites that reading with a constant, which is
# how the per-document licence stopped travelling. `document_license` is the only place
# a record's licence comes from.
HUMAN_SOURCE = {
    "ptwiki_lead": "src_wikipedia_pt",
}
GENERATED_LICENSE = "geracao-propria-v1"
# licenseId -> the inventory entry the dataset manifest publishes. It is an ALLOWLIST
# and not a lookup table: `validateDatasetManifest` refuses a record whose
# `provenance.licenseId` is absent from `manifest.licenses[]`
# (`DATASET_LICENSE_INVALID`), so a licence with no entry here is a licence no record
# may carry. The entries are the ones the corpus inventory has REVIEWED
# (docs/corpus-sources.md, mirrored in `CORPUS_LICENSE_REGISTRY`); the terms of a
# licence are that inventory's fact, and the assembler is not where a licence is
# reviewed for the first time.
LICENSE_INVENTORY = {
    "cc-by-sa-4.0": {
        "name": "CC BY-SA 4.0",
        "url": "https://creativecommons.org/licenses/by-sa/4.0/",
    },
    "cc-by-nc-sa-4.0": {
        "name": "CC BY-NC-SA 4.0",
        "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    GENERATED_LICENSE: {
        "name": "Geracao propria (nao comercial)",
        "url": "https://cleanfeed.local/license/geracao-propria-v1",
    },
}
# The licences `extract_carolina.LICENSE_MAP` admits at the document and the corpus
# inventory has NOT reviewed, each with the reason it cannot be carried yet. Declared
# rather than deleted, for the reason every other exclusion in this module is: an
# allowlist alone cannot tell a licence that was decided against from one nobody has
# looked at, and only the second case may stop the run
# (`UndecidedDocumentLicense`).
UNREVIEWED_DOCUMENT_LICENSES = {
    "cc-by-4.0": (
        "the extractor admits it at the document and the reviewed inventory carries no "
        "terms for it, so a record naming it would publish a licence whose clauses no "
        "artifact of this repository states"
    ),
    "public-domain": (
        "'public domain' is a status and not an instrument: which regime places the "
        "document there decides the obligations, and the TEI availability does not say"
    ),
}
HARD_NEGATIVE_FAMILIES = [
    "formulaic",
    "motivational",
    "highly-polished",
    "repetitive",
    "non-native",
    "corporate-structure",
]
# Which CELL a hard-negative style is drawn from (heuristic, presence-level). Every
# value has to be a cell the register above produces, and that is not bookkeeping:
# `tag_hard_negatives` takes each family's rows out of THAT cell's pool, so a style
# pointing at a cell no material feeds tags nothing, and the family it names is then
# missing from `requiredHardNegativeFamilies` — a release seal refused at the very end
# of an assembly, by a dict entry that looks harmless.
#
# With ONE cell every style is drawn from encyclopedic text, and that is a COST of the
# one-cell frame rather than a tidy result: three of the six styles (`repetitive`,
# `non-native`, `motivational`) occur in informal short-form text and are being looked
# for in Wikipedia lead sections, where they are rarer. The six families stay because
# `RELEASE_CORPUS_POLICY.requiredHardNegativeFamilies` requires all six and dropping one
# would move a sealed decision to dodge a scarcity; what the concentration costs is
# arithmetic, and `hard_negative_demand_per_cell` is where it is charged.
HN_REGISTER = {
    "formulaic": "ptwiki",
    "corporate-structure": "ptwiki",
    "highly-polished": "ptwiki",
    "repetitive": "ptwiki",
    "non-native": "ptwiki",
    "motivational": "ptwiki",
}


def collection_targets(policy_path: Path = POLICY_PATH) -> dict[str, int]:
    """The human collection quantities of the frozen pre-registration, cross-checked.

    `{"perCell", "perCellFloor", "total"}`, read from `collection` and never retyped.
    The two refusals are the sampling decision G0.3-bis, and they fire here because the
    corpus that violates either is refused far later and far more expensively:

      * the total has to be the per-cell target times the number of cells, because
        `sealDataset` compares the release composition by EXACT equality — a total
        derived from anything else describes a corpus no seal can accept;
      * the target has to be ABOVE the floor. The floor is the gate's number (human
        negatives per cell in `test`); the target is the collection's, and the margin
        between them is what the blind block's sampling variation needs. Collected at
        the floor, the expected count in `test` IS the floor and half the draws land
        under it.
    """
    collection = json.loads(policy_path.read_text(encoding="utf-8"))["collection"]
    per_cell = int(collection["humanLinesPerCellTarget"])
    floor = int(collection["humanLinesPerCellMinimum"])
    total = int(collection["humanLinesTotal"])
    if per_cell <= floor:
        raise ValueError(
            f"collection target of {per_cell} lines per cell is not above the floor of "
            f"{floor}: the margin the blind block's sampling variation needs would be "
            "zero, and half the draws would land under the per-cell FPR denominator"
        )
    if total != per_cell * len(QUOTA_CELLS):
        raise ValueError(
            f"collection total of {total} human lines is not {len(QUOTA_CELLS)} cells "
            f"x {per_cell}: the seal compares the composition by exact equality, so a "
            "total derived from anything but the per-cell target refuses every corpus "
            "that carries the collection margin"
        )
    return {"perCell": per_cell, "perCellFloor": floor, "total": total}


HUMAN_COLLECTION = collection_targets()
# The class quotas of one assembly. `human` is the pre-registration's collection total
# and is never a literal here; `ai` and `mixed` are the ratified generated counts of
# `RELEASE_CORPUS_POLICY.counts` (benchmark/dataset-manifest.ts), which is the artifact
# the seal compares against — the three are pinned against it by test, because the seal
# compares by exact equality and a lab that collects another composition builds a corpus
# it cannot seal.
TARGET = {"human": HUMAN_COLLECTION["total"], "ai": 4000, "mixed": 2000}
# validate rejects any DECLARED held-out family with fewer positives.
HELD_OUT_MINIMUM = 200
# Families that CANNOT be claimed as unseen by the detector, and therefore must
# never be declared held-out — a provenance judgment, not something derivable
# from the corpus.
#
# The training set holds 721 records from the ALIAS `gemini-flash-lite-latest`,
# generated 2026-07-22 22:20 to 2026-07-23 08:43. Nothing on either side records
# which concrete version that alias resolved to. The benchmark's flash-lite lanes
# were generated 2026-07-24 13:50-16:48 — some 30 hours later, through the same
# API and key — and no plausible model rotation happens in 30 hours, so "latest"
# was in all likelihood one of these very families. It cannot be proven either
# way (the raw API responses, which carry modelVersion, were never persisted),
# and the burden of proof belongs to the held-out claim: declaring one of these
# would measure a "generator never seen in training" that the detector saw 721
# times, inflating the generalization result in the direction nobody notices.
#
# They stay in the corpus as ordinary AI families — no record is discarded, only
# the claim is withdrawn.
HELD_OUT_INELIGIBLE = {"gemini-3_5-flash-lite", "gemini-3_1-flash-lite"}
# The generation slate's roles, NAMED, and compared by exact equality.
#
# `ood-reserved` is the unseen-generator test: no line of a reserved family may reach a
# partition the training set is drawn from, so a reserved family is seated whole in the
# blind block or its lines leave the corpus. ESTADO.md § 3.3 fixes which families those
# are — the LOCAL open-weight lineages — and neither a lane nor a name prefix can decide
# it. A prefix rule is worse than wrong, it is silent: a reserved family renamed by the
# provider stops matching, reads as core, and enters training with nothing reporting it.
# Under exact equality a rename lands in NEITHER list and stops the run
# (`UndeclaredGeneratorFamily`), which is the same asymmetry `UndecidedDomainSource`
# applies to sources — a decided exclusion is silent, an undecided one halts.
#
# WHAT THE RESERVE MEASURES, and it is narrower than the one this list used to hold: the
# reserved lineage is absent from training, so the OOD slice reads "a family of open
# weights the detector never saw" and not "a frontier provider absent from training". The
# OpenAI families moved to the core because ChatGPT is one of the families people
# actually use, and a detector blind to it is blind to the dominant case — which forced a
# fourth lineage, since `gpt-oss-120b-medium` is OpenAI lineage too and reserving it
# would reserve the recipe of a vendor already seen.
#
# The spellings are canonical (`generator_family` fixed points), because that is the form
# `groups.generatorFamily` carries; the dotted provider spelling would never match.
OOD_RESERVED_ROLE = "ood-reserved"
CORE_ROLE = "core"
EXCLUDED_ROLE = "excluded"
def generator_family(value: str) -> str:
    """A provider label -> THE canonical generator family.

    The single Python-side mirror of normalizeGeneratorFamily in
    benchmark/generator-family.ts: collapse every run outside [A-Za-z0-9_-] into
    one "_", strip leading/trailing SEPARATORS ("_" and "-"), preserve case. So
    "gemini-3.5-flash-low" -> "gemini-3_5-flash-low", and the underscore form maps
    to itself.

    Both separators, because "-" is in the token class too: stripping only "_" mapped
    "gemini-3.5-" to "gemini-3_5-", a canonical token DISTINCT from "gemini-3_5" --
    two spellings of one family, which is the defect this pair of functions exists to
    prevent. The two sides must agree character for character or the assembler writes
    a family the schema refuses, so this strip and the TypeScript one move together.
    slug() keeps the narrower strip: it mints ordinary grouping tokens, and widening
    it there would rewrite batch and template identities that name nothing canonical.

    The underscore spelling is canonical because the value has to live in
    groups.generatorFamily, and every grouping token is validated as a pseudonym
    (no ".", which is a PII separator) — so the dotted spelling the provider uses
    cannot be it. generation.family keeps the provider's literal label, because the
    governance audit matches it byte for byte against the declared batch recipe.

    Unlike slug() this FAILS instead of returning a placeholder: a family we cannot
    name is a governance problem, not a string to patch over. The TypeScript schema
    is the real enforcement — validateBenchmarkRecord refuses any record whose
    groups.generatorFamily is not exactly this function's output for its
    generation.family — so this function exists to make the assembler write what
    the schema will accept, not to be a second authority.
    """
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_-")
    if not out:
        raise ValueError(
            f"generator family {value!r} normalizes to nothing: "
            "it carries no character of [A-Za-z0-9_-]"
        )
    return out


def reserve_family(tag: str, quantization: str) -> str:
    """The canonical generator family of a local model, from its TAG and quantization.

    One function because two writers need the same answer and cannot be allowed to
    differ: the reserve's declaration below and the generation track that writes the
    rows. A family name typed twice is a family whose role applies to nothing.

    The quantization is part of the family and not a detail: two quantizations of one
    lineage are two generators, and the reserve exists to answer a question about
    LINEAGE — if one slice wrote worse, nobody could tell the lineage from the
    quantization. It is appended only when the tag does not already name it, because
    `llama3:8b-instruct-q4_K_M` carries it and `qwen2.5:7b` does not; appending
    unconditionally would name the same scheme twice.
    """
    token = quantization.replace("_", "").lower()
    stem = tag.replace(":", "-")
    if token not in stem.replace("_", "").lower():
        stem = f"{stem}-{token}"
    return generator_family(stem)


class CoverageMatrixRefused(RuntimeError):
    """A matriz de geracao declarada nao satisfaz a regra de cobertura por ilha."""


# Em quantas ILHAS DE NUCLEO uma familia geradora tem de aparecer.
#
# DOIS, e dois e o MINIMO que quebra a colinearidade -- nao uma alegacao de poder. Com uma ilha
# so, a familia fica em correspondencia um-para-um com os templates daquela ilha, e
# `groups.generatorFamily` e `groups.promptTemplate` passam a ser o mesmo fator com dois nomes:
# nenhuma reamostragem os separa, e a familia declarada em `mixed.levels` duplicaria o template
# em vez de acrescentar dependencia. Com duas, a correspondencia deixa de existir.
#
# O que DOIS nao compra: nada sobre a largura do intervalo nem sobre a fatia ter positivos
# bastantes. O piso de positivos e `criticalRecallPositives` e vive na pre-inscricao, nao aqui.
MINIMUM_ISLANDS_PER_FAMILY = 2


def assert_generation_coverage(assignments: dict[str, list[tuple[str, str]]]) -> None:
    """Recusa uma matriz de geracao ANTES da primeira chamada de provedor.

    `assignments` e ilha -> lista de `(modelo, effort)`. Modelo e effort sao argumento POR
    CORRIDA e nenhum artefato do plano os carrega, entao nao ha o que aferir sobre uma corrida
    que ainda nao houve -- o que esta funcao afere e a DECLARACAO de quem vai gerar, e o valor
    dela e o momento: uma matriz recusada aqui nao gastou cota.

    Tres recusas:

      * uma ilha de NUCLEO sem atribuicao. Ela nao produziria linha, a cota da classe nao
        fecharia, e isso hoje aparece no fim da corrida;
      * uma familia de nucleo em menos de `MINIMUM_ISLANDS_PER_FAMILY` ilhas, que e a
        colinearidade com o template;
      * ilha declarada que o plano nao tem.

    O EFFORT nao conta para a regra de ilhas: o mesmo modelo em dois efforts na mesma ilha
    continua a ser um modelo numa ilha so, e contar duas atribuicoes ali aprovaria exactamente
    a forma que a regra existe para recusar.

    As ilhas RESERVADAS sao isentas da regra de duas ilhas: a reserva mede novidade de FAMILIA
    e vive nas tres reservadas por desenho. O que elas exigem em troca e
    `reserve_seen_control_lines() > 0`, sem o que a fatia `unseen` fica confundida com os
    templates dessas ilhas -- e isso e propriedade do ALVO da reserva, conferida em
    `assert_the_reserve_target_fits`, nao da matriz.
    """
    do_plano = {ilha["island"]: ilha for ilha in ISLAND_PLAN}
    desconhecidas = sorted(set(assignments) - set(do_plano))
    if desconhecidas:
        raise CoverageMatrixRefused(
            f"a matriz declara ilha(s) que o plano nao tem: {desconhecidas}"
        )
    nucleo = [nome for nome, ilha in do_plano.items() if not ilha["reserved"]]
    vazias = sorted(nome for nome in nucleo if not assignments.get(nome))
    if vazias:
        raise CoverageMatrixRefused(
            f"as ilhas de nucleo {vazias} nao tem atribuicao: elas nao produzem linha, e a "
            "cota da classe nao fecha -- o que hoje se descobre no fim da corrida"
        )
    # Agrupado pela FAMILIA CANONICA e nao pelo modelo cru: a regra e sobre a familia, porque
    # e `groups.generatorFamily` que a reamostragem declara como fator. Duas grafias do mesmo
    # modelo contariam como dois, cada um numa ilha, e a guarda recusaria uma cobertura que a
    # familia de facto tem -- fail-CLOSED, mas divergente da regra que a docstring enuncia.
    ilhas_por_familia: dict[str, set[str]] = {}
    for nome in nucleo:
        for modelo, _effort in assignments.get(nome, []):
            ilhas_por_familia.setdefault(generator_family(modelo), set()).add(nome)
    curtos = {
        familia: sorted(ilhas)
        for familia, ilhas in sorted(ilhas_por_familia.items())
        if len(ilhas) < MINIMUM_ISLANDS_PER_FAMILY
    }
    if curtos:
        raise CoverageMatrixRefused(
            f"cada FAMILIA geradora tem de aparecer em ao menos "
            f"{MINIMUM_ISLANDS_PER_FAMILY} ilhas de nucleo, e estas nao: {curtos}. Com uma "
            "ilha so a familia fica em correspondencia um-para-um com os templates dela, e a "
            "reamostragem nao separa os dois fatores. Os nomes sao a forma CANONICA de "
            "`generator_family`, que e a que `groups.generatorFamily` carrega"
        )


class ReserveTargetInfeasible(RuntimeError):
    """O alvo de geracao da reserva nao cabe no bloco cego, ou fica abaixo do piso."""


# Quantas familias a reserva declara, e quantas linhas cada uma tem por ALVO DE GERACAO.
#
# O operador ratificou DUAS familias. O alvo por familia era prosa num comentario -- "duas
# familias de 450 linhas cada" -- e o numero que a prosa dizia NAO CABE: medido,
# `reserve_line_ceiling()` da 600 linhas `ai` e 2 x 450 = 900. Um alvo inviavel escrito em
# comentario descobre-se quando o corpus nao sela, e ai a cota ja esta gasta.
#
# 250 e a escolha, e a razao e a folga em DOIS eixos ao mesmo tempo:
#
#   * 2 x 250 = 500 cabe no teto de 600 e deixa 100 linhas dentro das ilhas reservadas para
#     familia de NUCLEO. Essas 100 sao o que torna o contraste `generatorExposure` seen/unseen
#     IDENTIFICAVEL: sem nenhuma linha vista sob os templates reservados, os dois niveis da
#     fatia nao partilham identidade de template alguma e a fatia mede o TEMPLATE e nao a
#     familia. `reserve_seen_control_lines()` publica esse numero;
#   * 250 fica 50 acima de `HELD_OUT_MINIMUM`, e essa folga tem consumidor: uma recusa do
#     provedor, uma linha podada por quase-duplicata ou um descarte de banda derruba a
#     contagem, e uma familia que cai abaixo do piso tem as linhas RETIRADAS do corpus
#     (`reserved_families_below_the_recall_floor`). No piso exacto (200) a folga e zero.
#
# O que 250 CUSTA, e fica dito: a reserva encolhe de 450 para 250 por familia, entao a fatia
# `unseen` tem menos positivos e o intervalo dela sai mais largo. A alternativa que preserva
# 300 por familia (2 x 300 = 600) enche as ilhas reservadas e leva o controle a ZERO, e ai a
# fatia deixa de identificar a familia -- largura menor sobre um estimando que nao e o alegado.
#
# O VALOR 450 e do operador; este nao. A mudanca e de plano, nao gasta cota e nao apaga
# material, entao e decidida aqui e ratificada no marco, no molde `AG - ratificado`.
RATIFIED_RESERVE_FAMILY_COUNT = 2
RESERVE_LINES_PER_FAMILY = 250


def reserve_line_ceiling() -> int:
    """Quantas linhas `ai` a reserva pode ter, DERIVADO e nao digitado.

    A MESMA aritmetica de `assert_island_plan_leaves_core_in_the_blind_block`, e por isso as
    duas nao podem discordar: a capacidade de `test` e o resto depois dos quatro blocos
    arredondados, e a guarda exige que sobre lugar para a menor ilha de NUCLEO -- sem o que o
    bloco cego fica inteiramente de reserva e a hipotese de recall sobre familia vista nao tem
    denominador.
    """
    total = ISLAND_PLAN_CLASS_LINES["ai"]
    capacidade = total - sum(
        round(total * CLASS_FRACTIONS[bloco]) for bloco in CLASS_FRACTIONS
    )
    nucleo = min(ilha["lines"]["ai"] for ilha in ISLAND_PLAN if not ilha["reserved"])
    return capacidade - nucleo


def reserve_seen_control_lines() -> int:
    """As linhas das ilhas reservadas que NAO sao da reserva, e por isso sao o controle `seen`.

    Elas partilham os templates das ilhas reservadas com as linhas da reserva, o que poe os
    dois niveis de `generatorExposure` sob a MESMA identidade de template. Zero aqui significa
    que a fatia `unseen` esta confundida com aqueles templates, e nenhuma reamostragem os
    separa.
    """
    assentado = sum(ilha["lines"]["ai"] for ilha in ISLAND_PLAN if ilha["reserved"])
    return assentado - RESERVE_LINES_PER_FAMILY * RATIFIED_RESERVE_FAMILY_COUNT


def assert_the_reserve_target_fits(lines_per_family: int, families: int) -> None:
    """Recusa um alvo de reserva que nao cabe no bloco cego, ou que fica abaixo do piso.

    Duas recusas e nao uma, porque as duas formas de o alvo ser inviavel sao independentes: um
    alvo grande estoura a capacidade de `test`, e um alvo pequeno passa pela capacidade e cai
    sob `HELD_OUT_MINIMUM`, onde as linhas da familia sao retiradas do corpus em vez de
    medidas.
    """
    teto = reserve_line_ceiling()
    total = lines_per_family * families
    if total > teto:
        raise ReserveTargetInfeasible(
            f"a reserva declara {families} familia(s) x {lines_per_family} = {total} linhas "
            f"`ai`, e o teto do bloco cego e {teto}: a capacidade de `test` menos o lugar que "
            "uma ilha de nucleo precisa. Um alvo acima disto nao sela, e descobre-se depois "
            "de a cota estar gasta"
        )
    if lines_per_family < HELD_OUT_MINIMUM:
        raise ReserveTargetInfeasible(
            f"a reserva declara {lines_per_family} linhas por familia, abaixo do piso "
            f"{HELD_OUT_MINIMUM} que `validate` exige: uma familia sob o piso tem as linhas "
            "RETIRADAS do corpus, entao o alvo cabe na capacidade e nao produz fatia"
        )


# ONE ENTRY, and the second ratified lineage is in RATIFIED_PENDING_RESERVE below rather
# than here: a role is a claim about material, and the llama has no line on disk. The
# reserve is two families (`qwen2.5:7b` and `llama3:8b-instruct-q4_K_M`, both Q4_K_M so
# lineage is the only variable); how many lines each is `RESERVE_LINES_PER_FAMILY`, which is
# ASSERTED against the blind block instead of written here.
OOD_RESERVED_FAMILIES = {
    reserve_family("qwen2.5:7b", "Q4_K_M"): (
        "Alibaba open weights at Q4_K_M, generated by the local `ollama` runtime; the "
        "unseen-generator claim of this release is a lineage of open weights absent "
        "from training, and this is the only material on disk whose harness version was "
        "captured — which is what `countsTowardHeldOutFloor` filters the reserve's "
        "positives floor by"
    ),
}
# RATIFIED AND NOT YET MATERIAL. The operator ratified a two-family reserve; this is the
# half that has no line on disk, and it is NAMED here instead of being an absence,
# because an absence is indistinguishable from a decision nobody took.
#
# It is deliberately NOT a fourth role. A role decides where a family's lines go, and
# these have none, so a role over them would be coverage of nothing — the defect
# `assert_slate_roles_are_consistent` exists to catch.
#
# WHAT THIS LIST BUYS, stated no stronger than it is: the two coverage rules already
# refuse both states it guards, in the same call and before any pool is opened, so the
# gain is a SPECIFIC message where the generic one said "a family with no role" — and
# "declare it `ood-reserved`, that is what it was ratified as" is what someone can act
# on at 3am. The one thing no other rule looks at is the SPELLING of this list, which is
# why that check is here too: nothing else reads these names, and the day one is
# promoted is exactly when nobody re-reads them.
RATIFIED_PENDING_RESERVE = {
    reserve_family("llama3:8b-instruct-q4_K_M", "Q4_K_M"): (
        "Meta open weights at Q4_K_M, the second lineage of the ratified reserve. The "
        "Community Licence is disarmed by the ROLE and not by a reading: a reserved "
        "component seats whole in `test`, so the text is evaluation material rather "
        "than something a model was trained on"
    ),
}
# TRAINABLE BY DECLARATION: the family appears in all five partitions and supports no
# unseen-generator claim. The list is not derived from the pools and does not claim to be
# — it is the families whose PROVENANCE the rows record and whose provider is not the
# reserved one; `POOL_GENERATOR_FAMILIES` is what turns "the three roles cover the pools"
# into a guard instead of a sentence.
# `gemini-flash-lite-latest` is an ALIAS and is core for that reason — the alias does not
# record which model answered, so it can never carry a reserve claim, and the two
# families the alias contaminated stay in `HELD_OUT_INELIGIBLE`.
CORE_GENERATOR_FAMILIES = frozenset(
    {
        "claude-fable-5",
        "claude-sonnet-4-6",
        "gemini-3-flash-preview",
        "gemini-3_1-flash-lite",
        "gemini-3_5-flash",
        "gemini-3_5-flash-lite",
        "gemini-3_5-flash-low",
        "gemini-3_5-flash-medium",
        "gemini-3_6-flash",
        "gemini-3_6-flash-low",
        "gemini-flash-lite-latest",
        "gemma-4-26b-a4b-it",
        # The two OpenAI lineages, core by the operator's decision. They arrive on
        # DIFFERENT lanes — `gpt-5.6-luna` through `codex`, `gpt-oss-120b-medium` only
        # through the `agy` harness — which is the standing reason no lane and no prefix
        # may stand in for the declaration: the provider boundary crosses the lane one.
        "gpt-5_6-luna",
        "gpt-oss-120b-medium",
    }
)
_ROUTED_PROVENANCE = (
    "generated through a router that dispatches to many providers, and the row records "
    "which corpus it came from and not which provider answered"
)
_UNRECORDED_PROVENANCE = (
    "a third-party synthetic corpus whose row records no provider and whose name says "
    "nothing about one"
)
# THE THIRD ROLE, and it exists because the pools carry a third case. `ai_reserved.jsonl`
# delivers 1.185 rows in nine families whose row records a corpus name and no provider:
# `madras_synthetic_corpus_openrouter*` came through a ROUTER that dispatches to many
# providers, `madras_victory_*` names nothing at all, and `madras_synthetic_corpus_gptoss5`
# names gpt-oss, which is the reserved provider.
#
# Neither of the other two roles can take them, and that is the whole argument:
#
#   * core is trainable, and training on a row that may have come from the reserved
#     provider destroys the only unseen-generator claim this release makes (ESTADO.md
#     § 3.3), which is exactly the silence the declaration-by-name exists against;
#   * reserving them would publish "a generator absent from training" for a generator
#     whose provider nobody can name — the same over-claim `HELD_OUT_INELIGIBLE` withdrew
#     — and every one of the nine is under `HELD_OUT_MINIMUM` besides.
#
# So the lines leave the corpus and are COUNTED. Provenance is a judgment about the world
# and is not derivable from the text (the same reason `HELD_OUT_INELIGIBLE` is a list):
# the day a row records its provider, the entry moves to whichever of the two other roles
# that provider names, and the cost of the move is one line here.
EXCLUDED_GENERATOR_FAMILIES = {
    "madras_synthetic_corpus_gptoss5": (
        "the name says gpt-oss, i.e. the reserved provider, and the row records no "
        "provider to confirm it either way"
    ),
    "madras_synthetic_corpus_openrouter": _ROUTED_PROVENANCE,
    "madras_synthetic_corpus_openrouter2": _ROUTED_PROVENANCE,
    "madras_synthetic_corpus_openrouter23": _ROUTED_PROVENANCE,
    "madras_synthetic_corpus_openrouter3": _ROUTED_PROVENANCE,
    "madras_synthetic_corpus_openrouter55": _ROUTED_PROVENANCE,
    "madras_synthetic_corpusqwn": (
        "a third-party synthetic corpus whose row records no provider; the name suggests "
        "Qwen and a name is not a provenance record"
    ),
    "madras_victory_1": _UNRECORDED_PROVENANCE,
    "madras_victory_2": _UNRECORDED_PROVENANCE,
}
# The generator families the DECLARED pool files deliver, canonicalized by
# `generator_family`. It is a measurement and it is here to be compared: every family in
# it must have exactly one role, and every role must name a family the pools deliver
# (`assert_slate_roles_are_consistent`).
#
# TWO POOL DIRECTORIES, and the census is the union of both: the v2 pools sit in
# `data/candidates` and the Phase 3 pools in `data/candidates-f3`, and `--candidates-dir`
# points a RUN at one of them while this census has to cover every file a run could read.
# Measuring only the default directory is what would leave a family delivered by the
# other one with no role. Re-measure after any change to the pools:
#
#   py -3.13 -c "import assemble_corpus as a, collections; \
#     rows = [r for d in (a.CAND, a.CAND.parent / 'candidates-f3') \
#             for r in a.load_ai(d) + a.load_mixed(d)]; \
#     print(collections.Counter(a.generator_family(str((r.get('meta') or {}).get('family') \
#     or r.get('model'))) for r in rows))"
#
# The counts are the rows on disk and not the rows that survive: measured 2026-08-05,
# 2.878 of the 4.048 ai rows of `candidates` and every one of its 2.135 mixed rows die
# earlier on absent metadata (`UnmappableLane`, `MissingRecipe`), so no excluded row
# reaches the role pass at all. The 400 reserved rows of `candidates-f3` are the
# exception, measured 2026-08-21: all 400 reach v3.
# Re-extraction is what revives the rest, which is exactly why the roles have to cover
# the pool BEFORE that and not when a family first survives.
POOL_GENERATOR_FAMILIES = {
    "claude-fable-5": 76,
    "claude-sonnet-4-6": 177,
    "gemini-3-flash-preview": 9,
    "gemini-3_1-flash-lite": 970,
    "gemini-3_5-flash": 4,
    "gemini-3_5-flash-lite": 500,
    "gemini-3_5-flash-low": 320,
    "gemini-3_5-flash-medium": 99,
    "gemini-3_6-flash": 19,
    "gemini-3_6-flash-low": 449,
    "gemini-flash-lite-latest": 98,
    "gemma-4-26b-a4b-it": 66,
    "gpt-5_6-luna": 1760,
    "gpt-oss-120b-medium": 451,
    "madras_synthetic_corpus_gptoss5": 88,
    "madras_synthetic_corpus_openrouter": 133,
    "madras_synthetic_corpus_openrouter2": 153,
    "madras_synthetic_corpus_openrouter23": 147,
    "madras_synthetic_corpus_openrouter3": 145,
    "madras_synthetic_corpus_openrouter55": 147,
    "madras_synthetic_corpusqwn": 150,
    "madras_victory_1": 125,
    "madras_victory_2": 97,
    "qwen2_5-7b-q4km": 400,
}
# No provider on these channels exposes a seed, so every declared batch records the
# same reason for its absence.
#
# `LAB_TEMPERATURE = 0.8` stood here and is DELETED. It had two readers before this
# task (`git show eae6ce6:benchmark/lab/assemble_corpus.py`, lines 246 and 302) and
# none after, because `decoding_config` now derives the temperature from the frozen
# LANE and from what the row recorded. Leaving a retyped 0.8 next to the function
# whose whole point is that the pools carry a temperature no lane ever applied is
# how it gets picked back up.
SEED_NULL_REASON = "provider API does not expose a sampling seed"
# The other half of the same pair, on the axis where a CLI lane genuinely applies
# nothing: every lane whose row sets `decodingConfigurable: false`
# (preregistration-v4.json) takes no sampling flag at all, so a batch of one of them
# must say that instead of a number nothing applied.
TEMPERATURE_NULL_REASON = "agent-CLI lane: the binary accepts no sampling flag"
# The mixed cohort this lane produces. The frozen contract
# (benchmark/preregistration-v4.json, `materialAssistance.generationMode`) closes
# the vocabulary at "mechanistic" | "ecological", and only the first is a fact
# about anything this project makes.
MECHANISTIC_GENERATION_MODE = "mechanistic"


def slug(value: str) -> str:
    """Any string -> pseudonym token /^[A-Za-z0-9_-]+$/ (never empty)."""
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return out or "x"


def norm_hash(text: str) -> tuple[str, str]:
    """(normalized_text, sha256) matching ingest's normalizeCorpusText: CRLF/CR
    -> LF then NFC."""
    normalized = unicodedata.normalize(
        "NFC", text.replace("\r\n", "\n").replace("\r", "\n")
    )
    return normalized, hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


# --- the review state: this assembler cannot produce a receipt (C5) ----------
#
# WHAT WAS HERE, AND WHY IT WAS FALSIFICATION. One constant naming the annotation
# protocol, two reviewer tokens and a declared concordance between them, plus one
# function returning a personal-data verdict of "passed" over a method that claimed
# both a machine and a human stage, a third reviewer token and a timestamp — both
# stamped onto every record.
#
# (Described in prose rather than pasted as the original literals, for the reason
# C2's `base_groups` note gives: `test_the_assembler_mints_no_review_receipt` greps
# this file for those tokens, and a comment quoting any of them verbatim would defeat
# the guard that keeps them from coming back. `git show
# 743767c:benchmark/lab/assemble_corpus.py` has the original bytes.)
#
# All 10.000 rows of the sealed corpus therefore assert that two named reviewers
# examined them and concurred, and that a third audited them for personal data and
# cleared them — and no human ever looked at a single row. The review timestamps
# were the partition BLOCK TIMES (1.000.000 ms and up,
# January 1970), so even the dates were the split's bookkeeping wearing a governance
# label. `integrity.review-ledger-hash` and `integrity.dataset-audit-sealed` passed
# over all of it, because both asked whether the field was PRESENT.
#
# That is inventing a reviewer, a date and a verdict: the one thing R4 names
# outright. §7 of the plan puts both blocks in "Descarte".
#
# WHAT REPLACES IT. Nothing that claims a review. Every record this assembler writes
# is `automated/unreviewed`, which is a first-class state in `benchmark/schema.ts`
# and not an absence: it names the automated filters that DID run and why no human
# audit did. The receipt arm exists in the schema and has NO producer here — D1/D5
# are the tasks that bring real reviewers, and until they do, a release seal is
# refused (DATASET_REVIEW_INVALID) rather than granted on a fabricated receipt.
#
# DO NOT ADD A RECEIPT BUILDER HERE. It would be one function away from a corpus
# that claims 10.000 reviews again, and the assembler is the only place with the
# means: it writes every row. A receipt has to enter from the review's own output,
# per record, and it has to name a real person's pseudonym and a real instant.
NO_HUMAN_AUDIT = (
    "no human reviewer was assigned to this corpus build: the extractors' automated "
    "filters ran and no audit did, so the record supports no review claim (C5/R4)"
)


def review_state(cand: dict | None = None) -> dict:
    """The `automated/unreviewed` block of one record.

    The filter list is READ from the candidate row (`meta.automatedFilters`, written
    by `common.CandidateWriter.offer` at the moment it ran them) and is EMPTY when
    the row does not carry one. Empty is the honest answer and not a gap to fill:
    pools written before that field existed record nowhere which screens saw them,
    and naming one here would be the same invention as the old constant with a
    smaller blast radius. It is the same discipline the grouping axes follow — a
    value the row does not have is stated as missing, never substituted (R6/R7).

    Generated and mixed rows pass `cand=None`: `common.CandidateWriter` is the human
    extraction path and the generation pools do not go through it, so no filter recorded
    ON THE CANDIDATE ROW ever saw them.

    THAT IS NO LONGER THE WHOLE TRUTH ABOUT A GENERATED ROW, and the sentence that used
    to end here — "no filter of ours screened a generated row for personal data" — is
    now false whenever the census screen runs: `llm-pii-screen` reads the single funnel,
    which is every class. What keeps this function honest is WHERE the run is written:
    `stamp_the_screen_run` appends it in `main()`, AFTER the disposition guard passed,
    and never here. A filter run written at this point would be a claim about a screen
    that had not yet been verified for this row.
    """
    meta = (cand or {}).get("meta") or {}
    declared = meta.get("automatedFilters")
    filters = list(declared) if isinstance(declared, list) else []
    return {
        "state": "automated/unreviewed",
        "automatedFilters": filters,
        # One spelling, read from the module constant, so 10.000 rows cannot end up
        # carrying two versions of the same sentence.
        "humanAuditAbsentReason": NO_HUMAN_AUDIT,
    }


# --- the grouping axes, from the identity the source actually has -------------
#
# WHAT WAS HERE, AND WHY IT WAS WRONG. `base_groups(rec_id, derivation_root)`
# returned a fresh identifier per record on five axes at once: author as
# a-underscore-recordId, source as g-, domainSource as ds-, collectionBatch as cb-
# and nearDuplicate as nd-, each interpolating the record id —
#
# (spelled out in prose rather than pasted as the original f-strings on purpose:
# `test_no_module_mints_a_per_record_group_token` greps this file for those five
# literals, and a comment quoting them verbatim would defeat the guard that keeps
# them from coming back. `git show 04c2cd5:benchmark/lab/assemble_corpus.py` has the
# original bytes.)
#
# — under the comment "All UNIQUE per record so the blocked split sees singleton
# components." Read as a design that is the whole defect stated out loud: the
# grouping axes were built to guarantee that the split would never find a shared
# component, and then the split's silence was read as evidence of no leakage.
#
# It is not merely uninformative, it is actively misleading in three measured ways:
#
#   * the blocked split reported `leakages: []` while separating identifiers that
#     could not collide — a true statement about nothing;
#   * `authorClusterKey` handed the bootstrap 10.000 distinct "authors", so a
#     clustered resample was i.i.d. and every interval came out narrower than the
#     data supports, in the direction that flatters the result;
#   * `nearDuplicate` could not name a cluster, so a surviving near-duplicate pair
#     cost BOTH records (ingest refuses every member of a cluster that straddles
#     more than one lineage) instead of collapsing to one representative.
#
# DO NOT REINTRODUCE IT AS AN OPTIMISATION. It is tempting, because a per-record
# token makes every downstream constraint pass on the first try: the split never
# refuses a component, no stratum is ever under-powered, no record is ever
# ineligible. That is exactly the reason it must not come back — it converts every
# check in the pipeline into a tautology. If an axis has no identity, the answer is
# `notApplicable` with a reason or `unknown` with a reason and the eligibility cost,
# and a source that cannot yield one of the three is a bug in the extractor.


class UnwritableInV3(ValueError):
    """The pool row cannot be expressed as a sealed record, so it leaves the corpus.

    A shared base so the assembler has ONE drop path: every subclass means the same
    thing operationally ("count it, name the reason, do not write it"), and none of
    them means "abort the assembly". The subclasses exist because the REASONS are
    different facts an operator has to act on differently — a lane that is not frozen
    needs a decision about the provider, a missing template digest needs a
    regeneration, a missing date needs a re-extraction.

    What no subclass ever means is "substitute a value and continue". Every one of
    these rows was accepted by the v2 schema, which asked for less; the corpus gets
    smaller and honest rather than complete and unverifiable.
    """


class UnmappableLane(UnwritableInV3):
    """The record's provider maps to no frozen generation lane.

    Its own type because the correct handling is to DROP the record, not to abort
    the assembly: the pools hold rows from providers the frozen lane table does not
    name (`openai`, the router corpora), and `groups.generationLane` must be `known`
    on every `ai` row. The table is not extensible from here — the lane vocabulary is
    sealed in the pre-registration — and naming a lane a row never ran on would be
    invented provenance (R4).
    """


class MissingRecipe(UnwritableInV3):
    """The pool row does not record enough of its own recipe to be written as v3.

    Also a drop-this-record signal rather than a crash. It fires on rows that the
    v2 schema accepted because v2 asked for less: `ai_reserved.jsonl` carries only
    {id, text, family, recipe, pairedWith, split} with no provider and no template
    digest, and the mixed pools never recorded which mixing template produced them.

    The alternative — reconstructing the missing field from whatever is in the lab
    scripts TODAY — is refused on purpose. The template in `make_mixed.EDIT_PROMPT`
    may not be the one that ran months ago, and a digest that merely looks plausible
    is worse than an absent row: it would make `promptTemplate` a cluster nobody can
    verify, which is the same class of defect as the per-record token above.
    """


class MissingMaterialBatch(UnwritableInV3):
    """The row does not name the MATERIAL it came from, and no value can be invented.

    `AXIS_STATE_RULE.sourceMaterialBatch` admits only `known` on a human row and on a
    mechanistic mixed one, so there is no eligibility-priced escape here: a row with no
    resolvable acquisition event is unwritable and leaves the corpus.

    The alternative is what the dead corpus did with `collectionBatch` — key a fallback
    on the stratum (`extraction_<domainSource>`) and let every row of one stratum share
    it. That is an invented cluster: it declares that rows acquired in different events
    depend on each other, and it declares it in the one axis the reviewed manifest is
    supposed to be the authority on. A batch this assembler makes up resolves against no
    `materialBatches` entry, so `assertMaterialBatchesResolve` would refuse it anyway —
    later, and after a full assembly run.
    """


class MissingExtractionRun(UnwritableInV3):
    """A human row that does not name the extraction RUN that wrote it.

    Diagnostic axis, non-negotiable state: `AXIS_STATE_RULE.extractionRun` admits only
    `known` on a human row, so there is no eligibility-priced escape here — the row is
    inexpressible and leaves the corpus, counted like every other unwritable line.

    Only the execution that OPENED the material can name itself, so the extractor stamps
    it per line and no layer of ours derives one. The pool FILE is not the run:
    `CandidateWriter` takes `append=True`/`start_sequence`, so one file can hold the lines
    of more than one execution, and a value keyed on its name would merge them into a run
    that never ran — destroying the one handle that traces a defect back to the execution
    that produced it. Deriving it from the stratum instead does the same thing, one level
    coarser.

    What this refusal does NOT establish: that the value came from an extractor. Nothing
    resolves a run id against the reviewed manifest — it is a frozen diagnostic axis, with
    no analogue of `assertMaterialBatchesResolve` — so a pool edited by hand passes. The
    extractor's id is DERIVED from its own bytes and the material version, which makes it
    recomputable by a third party; that is the whole of the guarantee.
    """


class OutOfFrameDomainSource(UnwritableInV3):
    """The row's `domainSource` is not one of the cells the declared frame contains.

    A counted drop and not an abort, for the same reason as every other subclass: the
    pools on disk hold material extracted before the frame was narrowed to one cell, and
    the honest outcome is a smaller corpus plus a count of what left.

    A refusal and not a `KeyError`, because the two facts an operator acts on are
    different and the message carries them: a source blocked on ACCESS TERMS needs a
    legal disposition to come back, a source with NO CELL needs an amendment of the
    frame itself. Both are named — no source leaves this pipeline by deletion.
    """


class UndecidedDomainSource(RuntimeError):
    """The row names a `domainSource` NO list of this module has decided about.

    Not an `UnwritableInV3`, on purpose: it stops the run instead of being counted as a
    drop. The asymmetry mirrors `extract_carolina.TypologyOutOfFrame` and it is the whole
    value of declaring exclusions instead of deleting them — an allowlist alone cannot
    tell a source that was DECIDED against from one nobody has looked at yet.

    The case that makes it fail-closed: `domainSource` is minted by the extractors as
    `carolina_<typology>`, and the Carolina typology directories are spelled with a space
    in some releases and an underscore in others. A re-extraction that slugs a name
    differently writes a pool whose rows belong to a cell whose FPR ceiling the release
    publishes — and dropping them as "outside the frame" would empty that cell in
    silence.
    """


class MissingLabelEvidence(UnwritableInV3):
    """A human row whose candidate does not carry the date it was labelled on.

    v3 requires `labelBasis` + `labelEvidenceRef` on every human record, because a
    human label with no stated basis is an assertion rather than evidence. The date
    is read from the source by the extractor; a candidate that lacks it came from a
    pool written before the extractors emitted it, and the honest outcome is to drop
    the row rather than to date it by guesswork.
    """


class MissingDocumentLicense(UnwritableInV3):
    """A human row whose candidate carries no licence, or one the inventory cannot
    publish.

    The licence is read from the DOCUMENT — Carolina declares availability per TEI
    header — and it is the document's own fact, so there is nothing to derive it from
    once the pool row omits it. A row whose licence the reviewed inventory has no entry
    for is the same case one step further along: the record would name a licence
    `manifest.licenses[]` cannot declare, and the seal refuses the whole corpus for it
    (`DATASET_LICENSE_INVALID`) rather than the one row.
    """


class GeneratedRowDeclaresAnotherLicense(RuntimeError):
    """A generated candidate whose pool row names a licence other than this repo's grant.

    A generated record's licence is not read from the row, because the text was produced
    here and the grant is this repository's to make (`GENERATED_LICENSE`). That holds only
    while every generated pool is this repository's own generation, and it is not a
    property of the loader: `import_public_corpus.py` writes a THIRD PARTY's generated
    corpus under that party's licence, and a pool of it reaching the generated builders
    would be republished under a grant nobody here can issue.

    Aborts rather than dropping the row: the wrong outcome is a corpus that is written and
    mislicensed, and a counted drop of every row of a pool is a silent way to get one.
    """


class UndecidedDocumentLicense(RuntimeError):
    """A licence NO list of this module has decided about, on a candidate or a record.

    Same asymmetry as `UndecidedDomainSource`, and the same reason: the two declared
    lists ARE the decision, so a licence in neither is one nobody has looked at.
    Dropping it as generically unreviewed is what would hide a source that started
    shipping a new availability string — the counted drop would grow and the reason
    would be a licence name nobody had read.
    """


# provider label in the pools -> the frozen lane it corresponds to. Data, not
# heuristics: `antigravity` is the name make_mixed_agy.py records for the SAME agy
# binary generate_ai.py calls `agy`, which is why both map onto one lane.
PROVIDER_LANE = {
    "agy": "agy",
    "anthropic": "claude-code",
    "antigravity": "agy",
    "codex": "codex",
    "gemini": "gemini-api",
    "gemini_cli": "gemini-cli",
    "ollama": "ollama",
}


class PolicyLanesUnreadable(RuntimeError):
    """The sealed pre-registration carries no readable `generationLanes` block.

    Translated instead of letting the index raise: this runs at IMPORT time, so a bare
    `KeyError('generationLanes')` surfaces as a collection-time crash of whatever imported
    this module — a stack with no statement of which file was expected to hold what. The
    block is the single authority over what each lane accepts, and a run without it must
    say so.
    """


# The frozen lane rows, read from the policy above rather than retyped: it is the single
# source of truth for what each lane accepts, and a copy here would be a second
# authority that can disagree with the schema.
def lane_rows() -> dict[str, dict]:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    lanes = policy.get("generationLanes")
    if not isinstance(lanes, dict) or not lanes:
        raise PolicyLanesUnreadable(
            f"{POLICY_PATH} carries no non-empty `generationLanes` object; "
            "every generated row's decoding is frozen there and nothing here may "
            "substitute for it"
        )
    return lanes


LANE_ROWS = lane_rows()


def lane_of(provider: str, declared: str | None = None) -> str:
    """The frozen lane of a pool row.

    `declared` wins when the generator recorded it, because a lane the generator
    WROTE DOWN is an observation and a lane derived from a provider label is an
    inference. The inference is kept as a fallback only for the pools written before
    generate_ai.py emitted the field.
    """
    lane = declared or PROVIDER_LANE.get(provider or "")
    if lane not in LANE_ROWS:
        raise UnmappableLane(
            f"provider {provider!r} (declared lane {declared!r}) is not one of the "
            f"frozen generation lanes {sorted(LANE_ROWS)}. The record cannot "
            "name a lane it never ran on, so it leaves the corpus"
        )
    return lane


def decoding_config(lane: str, meta: dict) -> dict:
    """`generation.decoding`, decided by the LANE and not by what the pool carries.

    MEASURED, and this is the sharpest datum C1 surfaced: generate_ai.py wrote
    `"temperature": str(TEMPERATURE)` into the meta of EVERY provider, including
    `agy`, `codex` and `gemini_cli`, which it invokes as CLIs with no sampling flag
    anywhere in the argv (`[AGY_BIN, "-p", prompt, "--mode", "plan", "--model",
    model]`). So the pools on disk carry temperature 0.8 on thousands of records
    where no temperature was ever applied.

    Under `decodingConfigurable: false` that number has nowhere to go and the schema
    refuses it outright, which is the right outcome: carrying it forward would let a
    reader — or a governance audit comparing a record against its declared batch —
    conclude that a sampling temperature was chosen for a run that had no such knob.
    """
    row = LANE_ROWS[lane]
    if not row["decodingConfigurable"]:
        return {"configurable": False}
    temperature = meta.get("temperature")
    return {
        "configurable": True,
        # The provider's own word for the strategy, when it names one. None is a real
        # state ("we did not set it, the default applied"), distinct from the
        # `configurable: false` branch above ("this lane has no such knob").
        "strategy": meta.get("decodingStrategy") or None,
        "temperature": float(temperature) if temperature not in (None, "") else None,
        "topP": float(meta["topP"]) if meta.get("topP") not in (None, "") else None,
        "repetitionPenalty": (
            float(meta["repetitionPenalty"])
            if meta.get("repetitionPenalty") not in (None, "")
            else None
        ),
    }


def effort_config(lane: str, meta: dict) -> dict:
    """`generation.effort`, from what the lane RECORDED — never from the model name.

    NOT DERIVED FROM THE MODEL ID SUFFIX, deliberately, even though on `agy` some
    model ids embed the tier (`gpt-oss-120b-medium`, `gemini-3.6-flash-low`) and the
    temptation to read it off the string is obvious. The precedence question is
    SETTLED by probe, and what the probes show is CONSISTENCY CHECKING and not
    exclusion: `--model gemini-3.5-flash-low --effort high` exits with "conflicts
    with", while `--model gemini-3.5-flash-low --effort low` RUNS. The id-tier form and
    the flag may co-occur when they AGREE, and only the contradiction is refused.
    `claude-sonnet-4-6 --effort high` exits with "not supported for model" and
    `gemini-3.1-pro --effort medium` with "available: low, high", so the ladder is
    per-model. No quantifier over every pair is measured here and none is claimed. What
    the probes establish is that an ACCEPTED run knows which source applied, so reading
    "medium" off a suffix would record a source the run never consulted — the invented
    identity R6 forbids.

    CONFIGURABILITY IS THE CONSERVATIVE VALUE and never the lane's. `configurable`
    states whether the effort was SETTABLE in this run, and the sealed schema bounds
    it by the lane (settable requires the lane to offer a `flag` source) without
    deciding it — `provider-default` with `configurable: true` is a legitimate codex
    record, because the provider chose a tier where we could have. What this writer
    can support from a pool row is narrower: the row records a source and a level and
    says nothing about settability, so `flag` is written as settable and everything
    else as not. A pool that records the settability is what would widen this; until
    one does, the wider value is not ours to write.

    The `not-supported` arm is only available on a lane whose frozen row offers it.
    `codex` does not: its `effortSources` are `flag` and `provider-default`, and both
    of those carry a level. A codex row whose effort was never recorded therefore
    cannot be written as v3 at all, and it is refused rather than given a level we
    do not know. That is a real blocker for the codex lane, not a quirk of this
    function — see the plan's C2 section.
    """
    row = LANE_ROWS[lane]
    level = meta.get("effortLevel")
    source = meta.get("effortSource")
    if level and source:
        return {
            "source": str(source),
            "configurable": str(source) == "flag",
            # The scale comes from the LANE, not from the record: effort is not
            # comparable across providers (codex reaches ultra, agy stops at high),
            # so a level without its own lane's scale would read as a shared ordinal.
            "scale": str(row["effortScale"]),
            "level": str(level),
        }
    if "not-supported" in row["effortSources"]:
        return {"source": "not-supported", "configurable": False}
    raise MissingRecipe(
        f"the lane {lane!r} offers effort sources {row['effortSources']} and none of "
        "them is 'not-supported', so every record of this lane must name an effort "
        "level and a source. This pool row records neither, and a level we did not "
        "observe is not ours to supply"
    )


def harness_axis(lane: str, meta: dict) -> dict:
    """`groups.harnessVersion` — the CLI binary that is an input to the text.

    Three-way and the difference is the whole of R6. On an API lane there is no
    binary of ours, so `notApplicable` is TRUE. Everywhere else there is one — an
    agent CLI that injects a system prompt, loops over tools, retries and
    post-processes, or a local runtime that applies the model's own chat template to
    the quantized weights it shipped — and its version is an input to the text:
    `notApplicable` there would be a false statement about the lane, and a
    synthesized version string would be a false statement about the world. What is
    left is `unknown` — true, and priced at the record's eligibility.

    MEASURED, by provider, over the declared pools: `ollama` records the version on
    400 of 400 rows and every other harness provider on 0 of its own. So the
    `unknown` arm is what the v2 generation runs cost — those records are ineligible
    until they are regenerated — and the reserve's positives floor, which
    `countsTowardHeldOutFloor` filters by eligibility, is reachable only from the
    lane that captured it.
    """
    row = LANE_ROWS[lane]
    if row["channel"] == "api":
        return group_axes.not_applicable(
            f"the lane {lane!r} is a direct API call: no harness binary runs, so "
            "there is no version to attribute"
        )
    version = meta.get("harnessVersion")
    if version:
        return group_axes.known(group_axes.axis_token(str(version)))
    return group_axes.unknown(
        f"the lane {lane!r} runs a harness binary whose version this generation run "
        "did not capture. The axis applies, so notApplicable would be false; the "
        "record is ineligible instead of being given a version we never read"
    )


def seed_pair(meta: dict) -> dict:
    """Exactly one of `seed` / `seedNullReason`, and NEVER an invented seed.

    The sealed schema refuses a recipe carrying both or neither, and the rule matters
    beyond well-formedness: a seed is the one field that would make a generation
    reproducible, so a fabricated one is a claim that the text can be regenerated
    when it cannot. D3 states the same prohibition.

    An EMPTY seed is not a seed. The pools spell the absent case as `"seed": ""` plus
    a reason, so a truthiness test is what reads them correctly; `is not None` would
    write `seed: ""` and be refused by `nonEmptyString` anyway — loudly, which is
    fine, but at the cost of a full assembly run to discover.

    Defaulting fills in the REASON and never the seed, which is the safe half. It is
    also the half that narrowed: the `ollama` lane DOES expose a seed and its rows
    record one, so "there was no seed" stopped being a fact about every lane. It
    remains true of the rows that take this branch, which are the ones whose pool
    recorded no seed on a lane that offers none — and a seed invented for them would
    claim the text can be regenerated.
    """
    seed = meta.get("seed")
    if seed:
        return {"seed": str(seed)}
    return {"seedNullReason": str(meta.get("seedNullReason") or SEED_NULL_REASON)}


def named_seed_identity(row: dict) -> str | None:
    """A IDENTIDADE do pai humano que esta linha de pool vai nomear em `humanSeed`.

    UMA autoridade, e por isso e uma funcao: quem escreve o eixo (`ai_record`), quem
    protege a semente na selecao e quem cascateia o drop da triagem tem de concordar sobre
    qual registro a linha nomeia. Duas derivacoes do mesmo valor divergiriam no dia em que
    uma delas ganhasse um `slug` que a outra nao tem — que foi exactamente o defeito que o
    cross-review achou na identidade.

    Devolve `None` quando a receita respondeu a um topico sem pai humano: nao ha semente a
    proteger nem linhagem a resolver.
    """
    stamped = row.get(PARENT_IDENTITY_FIELD)
    if stamped:
        # O CARIMBO PRIMEIRO, pela mesma razao que `funnel_key` o le primeiro: depois de
        # `link_derived_to_parents` a referencia crua pode nomear uma cadeia que mudou de
        # dono, e o eixo tem de nomear o registro que esta no corpus.
        return stamped
    meta = row.get("meta") or {}
    parent = meta.get("pairedWith") or parent_of_prompt(str(meta.get("promptId") or ""))
    if not parent:
        return None
    return group_axes.axis_token(str(parent))


def parent_of_prompt(prompt_id: str) -> str | None:
    """The human seed a generated row came from, out of its `promptId`.

    The observed format is `<recipe>_<candidateId>` — `original_src_b2w_00848b3bc692`
    — so the parent is everything after the first underscore. Split on the FIRST
    underscore only: candidate ids contain underscores themselves
    (`src_b2w_00848b3bc692`), and splitting on the last would return a hex fragment
    that resolves to no record.
    """
    if not prompt_id or "_" not in prompt_id:
        return None
    _, parent = prompt_id.split("_", 1)
    return parent or None


# Whether a recipe REWRITES its parent text rather than writing new text about the same
# subject. Only a rewrite makes the row a DERIVATION of the parent; a recipe that writes
# fresh text from a seed leaves `derivationRoot` notApplicable while its `humanSeed` is
# known, and collapsing the two axes would either invent a derivation or lose the seed —
# which is why benchmark/schema.ts keeps them separate.
#
# It reads the slate's DECLARED `task` field and never the recipe NAME: the slate is
# partitioned by island, so the name is `pt-ilha-07-a` and says nothing about the task. A
# recipe the slate does not declare is refused ROW BY ROW, because guessing either way
# writes a connectivity axis out of nothing — `False` would silently drop the derivation of
# every paraphrase, and no count would move.
# O slate RETIRADO de quatro generos -> a tarefa de cada uma das receitas dele. Os pools em
# disco foram gerados sob ele, e a tarefa de uma linha JA ESCRITA e fato historico: nao e
# inventavel, nao e recuperavel do slate de hoje — que e particionado por ilha e nao carrega
# aqueles nomes — e nada no arquivo escrito a diz. Sem esta tabela toda linha daqueles pools
# seria recusada por receita nao declarada, e o que se perderia nao e material: e a MEDICAO
# que dois testes fazem sobre eles (a igualdade `version == family` sobre as 1.170 linhas e as
# corridas de template que o catalogo compartilhado cita).
#
# A tabela nao readmite nada: quem decide o que entra num corpus de release e o plano de
# ilhas, e um nome retirado nao pertence a ilha alguma. O que ela permite e LER o que ja foi
# escrito, que e outra pergunta.
RETIRED_GENERATION_TASKS: dict[str, str] = {
    "original": "original",
    "parafrase": "parafrase",
    "social": "feed",
    "humanizado": "comentario",
}


def recipe_rewrites_parent(recipe: object) -> bool:
    if recipe is None:
        return False
    nome = str(recipe)
    try:
        return generate_ai.recipe_rewrites_the_parent(nome)
    except generate_ai.UnknownRecipe as refusal:
        tarefa = RETIRED_GENERATION_TASKS.get(nome)
        if tarefa is None:
            raise MissingRecipe(str(refusal)) from None
        return tarefa in generate_ai.REWRITING_TASKS


def generation_axes(
    lane: str,
    family: str,
    version: str,
    recipe: str | None,
    template_digest: str,
    meta: dict,
) -> dict:
    """The six axes that name a piece of the generation apparatus."""
    return {
        "promptTemplate": group_axes.known(
            # The TEMPLATE, identified by the digest of its own bytes, so two records
            # of one recipe share the axis and a template edited between runs does
            # not silently pool with its predecessor. The recipe NAME is carried too
            # when the pool recorded it, because a digest alone is unreadable in a
            # cluster report.
            group_axes.axis_token(f"{recipe or 'recipe'}_{template_digest[:16]}")
        ),
        "generatorFamily": group_axes.known(generator_family(family)),
        "generatorVersion": group_axes.known(group_axes.axis_token(version)),
        "generationLane": group_axes.known(lane),
        "harnessVersion": harness_axis(lane, meta),
    }


def label_evidence(cand: dict, source_id: str, license_id: str) -> tuple[dict, dict]:
    """(labelEvidenceRef, the private entry it resolves against).

    The `human` label of every row in this corpus rests on ONE fact: the text
    predates the ChatGPT launch, read from a date field the source itself carries.
    v3 makes the row say so — which field, what value, against which cutoff, out of
    which snapshot — instead of asserting "human" and leaving the reader to trust it.

    `entryId`/`entryDigest` name an entry of the PRIVATE manifest and the digest of
    that entry's canonical bytes; only the digest crosses into the record, which is
    what keeps the private file out of every published artifact. The entry is per
    REGISTRATION (this base, this snapshot, this licence, this date field) while the
    payload is per RECORD (the value read for this row), and that split is the
    schema's, not ours.

    The `entryId` names the LICENCE for a reason the resolution contract forces:
    `assertLabelEvidenceResolves` indexes `entryId -> entryDigest`, one digest per id,
    and the licence is inside the digested bytes. Two documents of one snapshot under
    different licences are two registrations, so an id that omitted the licence would
    give them one key and two digests — the index would keep whichever was written last
    and every record pointing at the other would fail resolution on a digest
    divergence, which is the one refusal that names nothing an operator can act on.

    SCOPE: the canonical private source manifest is D1's artifact. What this function
    writes is the assembler's own evidence index, digest-consistent by construction
    with the records it emits, so C3's `assertLabelEvidenceResolves` has something
    real to resolve. It is not a stand-in for D1's registration and it does not
    record the snapshot digests, which the shared context assigns to D1.
    """
    meta = cand.get("meta") or {}
    date_field = meta.get("dateField")
    observed = meta.get("observedValue")
    snapshot = meta.get("snapshot") or SOURCE_SNAPSHOT.get(source_id)
    if not date_field or not observed or not snapshot:
        raise MissingLabelEvidence(
            f"candidate {cand.get('candidateId')!r} carries no "
            f"dateField/observedValue/snapshot (got {date_field!r}, {observed!r}, "
            f"{snapshot!r}), so its human label has no stated basis. Re-extract the "
            "pool with the current extractors; the date is not ours to guess"
        )
    entry = {
        "entryKind": "human-source-registration",
        "sourceId": source_id,
        "snapshot": snapshot,
        "licenseId": license_id,
        "dateField": date_field,
        "cutoff": CUTOFF_ISO,
    }
    # Canonical bytes: sorted keys, no spaces. The digest has to be reproducible by
    # anyone holding the entry, so the serialization is pinned rather than incidental.
    canonical = json.dumps(entry, sort_keys=True, separators=(",", ":"))
    entry_id = (
        f"ev_{group_axes.axis_token(source_id)}"
        f"_{group_axes.axis_token(snapshot)}"
        f"_{group_axes.axis_token(license_id)}"
    )
    entry_digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    ref = {
        "basis": "date-cutoff",
        "entryId": entry_id,
        "entryDigest": entry_digest,
        "dateField": date_field,
        "observedValue": observed,
        "cutoff": CUTOFF_ISO,
        "snapshot": snapshot,
    }
    return ref, {"entryId": entry_id, "entryDigest": entry_digest, **entry}


def near_duplicate_axis(cand_id: str) -> dict:
    """`groups.nearDuplicate` — THE ROW'S OWN ID, because pruning left it alone here.

    Stated plainly, because an earlier version of this docstring claimed more than
    the code did: it said the identity was "read from the pruning result" and "would
    collide the moment two rows shared a cluster", via a `representative` parameter
    that `main()` never passed and that `near_dupes.prune` could not have supplied
    anyway — prune returns `(drop, stats)` and no row-to-representative map. So the
    value was always `cand_id`, and the claimed mechanism did not exist. The
    parameter is gone rather than wired, for the reason below.

    WHY THE ROW'S OWN ID IS THE HONEST VALUE HERE, and not the per-record token this
    task removed. `main()` runs `near_dupes.prune` over all three pools and DROPS
    every non-representative before any record is built, so by the time this function
    is called each surviving row is the sole member of its near-duplicate cluster.
    Naming a one-member cluster after its one member is a description of the pruning
    result, not an identifier minted to avoid collisions. That is also why wiring a
    representative map would buy nothing: it would be the identity function on every
    row that reaches here, an always-inert parameter that reads like a real one.

    The difference from `nd_<recordId>` is therefore in the JUSTIFICATION and not in
    the value, and the value is genuinely the same. The old token was minted per
    record BECAUSE uniqueness made the split report `leakages: []`; this one is one
    per record because pruning made the clusters singletons. An all-singleton
    distribution on this axis is the evidence that pruning worked, which is exactly
    why R6 and the plan forbid a "no axis may be 100% singletons" criterion — it
    would flag this axis for being correct.

    The consequence to keep in mind: this axis carries no information the record id
    does not already carry, so it cannot be the axis that catches a leaked
    near-duplicate pair. What catches that is the pruning step itself, and if pruning
    is ever changed to KEEP both members of a cluster, this function has to change
    with it — a shared cluster id would then be a real datum, and it would have to
    come from a prune that publishes one.
    """
    return group_axes.known(group_axes.axis_token(cand_id))


def out_of_frame_reason(domain_source: str) -> str:
    """Why a `domainSource` is outside the declared frame, in the frame's own words.

    One lookup for both refusals below, so a human row and a mixed row of the same base
    cannot be dropped with two different explanations.

    A source in NEITHER declared list has no reason to report, and this is where that
    becomes an abort instead of a sentence: the two lists are the decision, so a name
    outside both is undecided (`UndecidedDomainSource`).
    """
    reason = OUT_OF_FRAME_DOMAIN_SOURCES.get(
        domain_source
    ) or A1_BLOCKED_DOMAIN_SOURCES.get(domain_source)
    if reason is None:
        raise UndecidedDomainSource(
            f"the domainSource {domain_source!r} is in no list this module decides "
            "with: it is not the declared cell "
            f"({', '.join(sorted(REGISTER))}), it is not refused on access terms "
            f"({', '.join(sorted(A1_BLOCKED_DOMAIN_SOURCES))}), and it is not declared "
            f"outside the frame ({', '.join(sorted(OUT_OF_FRAME_DOMAIN_SOURCES))}). "
            "Decide it in one of the three before assembling: dropping it as generically "
            "out of frame is how a renamed pool empties a cell whose ceiling the release "
            "publishes"
        )
    return reason


def cell_of(cand: dict) -> tuple[str, str]:
    """(quota cell, provenance.sourceId) of one human candidate.

    The single place a `domainSource` is turned into the frame's vocabulary, so the
    register and the source of a row cannot be decided by two different lookups that
    disagree. Refuses a source the frame does not contain, naming it, WHY it is outside,
    and the sources that are admissible.
    """
    domain_source = str(cand.get("domainSource") or "")
    if domain_source not in HUMAN_SOURCE:
        raise OutOfFrameDomainSource(
            f"candidate {cand.get('candidateId')!r} names the domainSource "
            f"{domain_source!r}, which is outside the declared frame: "
            f"{out_of_frame_reason(domain_source)}. "
            f"Admissible: {', '.join(sorted(HUMAN_SOURCE))}"
        )
    return REGISTER[domain_source], HUMAN_SOURCE[domain_source]


def document_license(cand: dict) -> str:
    """The licence THIS DOCUMENT declared, on its way to the assembled record.

    The extractor reads it out of the document — the Carolina TEI availability element,
    per `<TEI>`, against a fail-closed allowlist — and writes it on the pool row. This
    function is the rest of that journey, and it is the whole of D8: there is no second
    authority to fall back on, because a licence derived from the stratum describes the
    base and the base is not what the header declared.

    Three outcomes, and the split is the one every other declared exclusion in this
    module uses: a licence the inventory publishes travels; a licence the inventory has
    DECIDED it cannot publish yet drops the row and is counted; a licence NO list names
    stops the run.
    """
    license_id = str(cand.get("licenseId") or "")
    if not license_id:
        raise MissingDocumentLicense(
            f"candidate {cand.get('candidateId')!r} carries no licenseId, so the record "
            "would name no licence at all. The licence is the document's own — the "
            "extractor reads it from the header — and re-extracting the pool is the only "
            "way to recover it"
        )
    if license_id in LICENSE_INVENTORY:
        return license_id
    if license_id in UNREVIEWED_DOCUMENT_LICENSES:
        raise MissingDocumentLicense(
            f"candidate {cand.get('candidateId')!r} declares the licence "
            f"{license_id!r}, which the reviewed inventory cannot publish: "
            f"{UNREVIEWED_DOCUMENT_LICENSES[license_id]}. Publishable: "
            f"{', '.join(sorted(LICENSE_INVENTORY))}"
        )
    raise UndecidedDocumentLicense(
        f"candidate {cand.get('candidateId')!r} declares the licence {license_id!r}, "
        "which is in no list this module decides with: it is not in the reviewed "
        f"inventory ({', '.join(sorted(LICENSE_INVENTORY))}) and it is not declared "
        f"unreviewed ({', '.join(sorted(UNREVIEWED_DOCUMENT_LICENSES))}). Decide it in "
        "one of the two before assembling: a source that starts shipping a new "
        "availability string would otherwise grow the counted drop under a licence name "
        "nobody has read"
    )


def generated_license(cand: dict) -> str:
    """This repository's own grant, after checking the row does not contradict it.

    The counterpart of `document_license` for the two generated classes, and the reason it
    is a function rather than the constant inline: a generated pool row that names a licence
    is naming somebody else's, and the only safe reading of that is a refusal.
    """
    declared = str(cand.get("licenseId") or "")
    if declared and declared != GENERATED_LICENSE:
        raise GeneratedRowDeclaresAnotherLicense(
            f"generated candidate {cand.get('candidateId') or cand.get('parentId')!r} "
            f"declares the licence {declared!r}, and a generated record is written under "
            f"{GENERATED_LICENSE!r} — the grant this repository can make for text it "
            "produced. A pool carrying another licence is another party's generation, and "
            "its rows may not be republished under ours: give it its own sourceId and "
            "licence in the reviewed inventory, or keep it out of the generated pools"
        )
    return GENERATED_LICENSE


# --- record builders (return the canonical dict, block_time filled later) ----


def human_record(
    cand: dict,
    register: str,
    hard_neg: str | None,
    evidence_sink: list | None = None,
) -> dict:
    rec_id = funnel_key(cand)
    cell, source_id = cell_of(cand)
    license_id = document_license(cand)
    if register != cell:
        # The cell decides WHICH FPR ceiling counts this row, so a label that disagrees
        # with the row's own source would count a human negative under a population it
        # was not drawn from — and the published ceiling for both cells would then be
        # about a mixture. Caller-supplied and cross-checked rather than only derived:
        # the argument is what the assembly states it is collecting.
        raise OutOfFrameDomainSource(
            f"candidate {cand.get('candidateId')!r} is material of the cell {cell!r} "
            f"and was passed the cell {register!r}: the two decide different FPR "
            "ceilings, and a row counted under the wrong one moves both"
        )
    meta = cand.get("meta") or {}
    axes = dict(meta.get("groupAxes") or {})
    ref, entry = label_evidence(cand, source_id, license_id)
    material_batch = str(meta.get("sourceMaterialBatch") or "")
    if not material_batch:
        raise MissingMaterialBatch(
            f"human candidate {rec_id!r} names no sourceMaterialBatch, so the acquisition "
            "event its material came from is not recoverable from the row. The extractor "
            "reads it from the material it opened and the reviewed manifest declares it; "
            "a value derived here from the stratum would be a cluster nobody can verify"
        )
    extraction_run = str(meta.get("extractionRun") or "")
    if not extraction_run:
        raise MissingExtractionRun(
            f"human candidate {rec_id!r} names no extractionRun, so the execution that "
            "read its material is not recoverable from the row. Only the execution that "
            "opened the material can name itself, and no layer here derives one — not from "
            "the stratum, and not from the name of the pool file this row was read out of. "
            "Re-extract the pool with the extractor whose source id this candidate id "
            "already carries (benchmark/lab/extract_*.py --snapshot-version <version>)"
        )
    # AFTER every refusal, so a dropped candidate contributes no entry: the index is
    # the evidence for rows that exist, and a registration listed there for a row the
    # corpus does not contain is a claim about nothing.
    if evidence_sink is not None:
        evidence_sink.append(entry)
    rec = {
        "schemaVersion": 4,
        "id": rec_id,
        "text": cand["text"],
        "label": "human",
        "language": "pt-BR",
        "platform": "generic",
        "domain": register,
        "topic": "geral",
        "humanSourceType": register,
        "wordCount": int(cand["wordCount"]),
        # The whole basis of the human label, and the entry it resolves against.
        "labelBasis": "date-cutoff",
        "labelEvidenceRef": ref,
        "provenance": {
            "sourceKind": "licensed-corpus",
            "sourceId": source_id,
            "sourceRevision": "rev_001",
            "licenseId": license_id,
            "legalBasis": "license",
        },
        # The candidate is passed so the filters the EXTRACTOR ran travel with the
        # row instead of being asserted here.
        "review": review_state(cand),
        "transformation": {"kind": "none", "severity": "none"},
        "groups": {
            # From the SOURCE, via the extractor. `author` is `known` (HMAC
            # pseudonym), `notApplicable` (Wikipedia has no single author, Carolina
            # headers are never read) or `unknown` (deleted account) — the extractor
            # decides, because it is the only layer that saw the row.
            "author": axes.get("author")
            or group_axes.unknown(
                "the candidate pool predates the extractors that emit an author axis"
            ),
            "source": axes.get("source")
            or group_axes.unknown(
                "the candidate pool predates the extractors that emit a source axis"
            ),
            "domainSource": group_axes.known(
                group_axes.axis_token(cand["domainSource"])
            ),
            # A human row seeds generations; it is not itself seeded by one, and it
            # derives from nothing. Both are statements, and neither costs the row.
            "humanSeed": group_axes.not_applicable(
                "the record IS the human text: it is a seed, not something seeded"
            ),
            "promptTemplate": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "generatorFamily": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "generatorVersion": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "generationLane": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "harnessVersion": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            # The ACQUISITION EVENT the material came from: the unit of dependence
            # between acquisitions, declared in the reviewed manifest's
            # `materialBatches` and resolved against it by
            # `assertMaterialBatchesResolve`. Re-extracting the same dump does NOT
            # produce a new one, which is why the run below is a separate axis.
            "sourceMaterialBatch": group_axes.known(
                group_axes.axis_token(material_batch)
            ),
            # A human row can no longer name a generation batch at all: the rule admits
            # only `notApplicable` here, so the non-collision the dead corpus bought with
            # an `extraction_` prefix is now structural.
            "generationBatch": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            # The EXTRACTION RUN that wrote the row, as the EXTRACTOR named it: which
            # extraction module read which version of the material. Diagnostic — it names
            # no dependence, and it exists so a defect traces back to the execution.
            # CARRIED and never derived: this builder cannot tell a token an extractor
            # computed from one somebody typed into the pool, and what it imposes is that
            # a value exists and that no layer of ours invented it.
            "extractionRun": group_axes.known(
                group_axes.axis_token(extraction_run)
            ),
            "nearDuplicate": near_duplicate_axis(rec_id),
            "derivationRoot": group_axes.not_applicable(
                "the record is an extracted source text, derived from nothing in "
                "this corpus"
            ),
        },
    }
    if hard_neg is not None:
        rec["hardNegativeFamily"] = hard_neg
    return rec


def ai_record(cand: dict) -> dict:
    # AHEAD of every drop path: a mislicensed pool must abort rather than leave by
    # `UnmappableLane` or `MissingRecipe`, which would take it out row by row with the
    # licence never mentioned.
    license_id = generated_license(cand)
    meta = cand.get("meta") or {}
    rec_id = funnel_key(cand)
    family_raw = meta.get("family") or cand.get("family") or "unknown"
    lane = lane_of(str(meta.get("provider") or ""), meta.get("generationLane"))
    # The governance audit compares generation.promptSha256 against the batch's
    # promptTemplateDigest, so the record carries the TEMPLATE digest (shared by
    # every record of a recipe) rather than the per-record full-prompt digest, which
    # would force one declared batch per record. The instance stays identifiable
    # through promptId.
    template_digest = meta.get("promptTemplateDigest") or meta.get("promptSha256")
    if not template_digest:
        raise MissingRecipe(
            f"candidate {rec_id!r} records no prompt template digest, so its "
            "promptTemplate axis has no identity. v2 accepted such a row by keying "
            "a fallback on the family name; v3 requires the axis to be known, and a "
            "digest we invent is a cluster nobody can verify"
        )
    recipe = meta.get("recipe")
    prompt_id = slug(meta.get("promptId") or f"repro_{rec_id}")
    parent = named_seed_identity(cand)
    model = str(meta.get("model") or family_raw)
    version = str(meta.get("version") or family_raw)
    axes = generation_axes(lane, str(family_raw), version, recipe, template_digest, meta)
    rec = {
        "schemaVersion": 4,
        "id": rec_id,
        "text": cand["text"],
        "label": "ai",
        "language": "pt-BR",
        "platform": "generic",
        "domain": "geral",
        "topic": "geral",
        "wordCount": int(cand["wordCount"]),
        "provenance": {
            "sourceKind": "controlled-generation",
            "sourceId": "src_ai",
            "sourceRevision": "rev_001",
            "licenseId": license_id,
            "legalBasis": "generated",
        },
        "review": review_state(),
        "generation": {
            "provider": str(meta.get("provider") or "reserved"),
            "family": str(family_raw),
            "model": model,
            "version": version,
            "promptId": prompt_id,
            "promptSha256": str(meta.get("promptSha256") or template_digest),
            "promptTemplateDigest": str(template_digest),
            "decoding": decoding_config(lane, meta),
            "effort": effort_config(lane, meta),
            **seed_pair(meta),
        },
        "transformation": {"kind": "none", "severity": "none"},
        "groups": {
            # Generated text has no human author and comes from no origin document,
            # and both of those are facts rather than gaps. The v2 fixtures wrote
            # `author: "author_gen_001"` on generated rows — a person-shaped token
            # for a row with no person.
            "author": group_axes.not_applicable(group_axes.NO_HUMAN_AUTHOR),
            "source": group_axes.not_applicable(
                "generated text has no origin document: its input was a prompt, "
                "which is groups.promptTemplate, and a seed, which is groups.humanSeed"
            ),
            "domainSource": group_axes.known(
                group_axes.axis_token(str(cand.get("domainSource") or f"ai_{lane}"))
            ),
            "humanSeed": (
                # Ja e token de eixo: `named_seed_identity` o converte, e converter duas
                # vezes seria a segunda grafia que esta funcao existe para nao haver.
                group_axes.known(parent)
                if parent
                else group_axes.not_applicable(
                    "the recipe answered a bare topic prompt with no human parent"
                )
            ),
            **axes,
            "sourceMaterialBatch": group_axes.not_applicable(
                group_axes.NO_MATERIAL_ACQUIRED
            ),
            # Filled by assign_generation_batches once every record knows its
            # temporal block, because generatedAt is part of the batch key.
            "generationBatch": group_axes.unknown(
                "the generation batch is derived after partitioning"
            ),
            "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
            "nearDuplicate": near_duplicate_axis(rec_id),
            "derivationRoot": (
                group_axes.known(group_axes.axis_token(str(parent)))
                if parent and recipe_rewrites_parent(recipe)
                else group_axes.not_applicable(group_axes.NO_DERIVATION)
            ),
        },
    }
    return rec


def mixed_record(cand: dict) -> dict:
    license_id = generated_license(cand)
    parent = parent_identity(cand)
    rec_id = funnel_key(cand)
    text = cand["text"]
    spans = cand["mixture"]["spans"]
    total = len(text)
    ai_chars = sum(s["end"] - s["start"] for s in spans if s["origin"] == "ai")
    ai_fraction = ai_chars / total if total else 0.0
    model = str(cand.get("model") or "unknown")
    lane = lane_of(str(cand.get("provider") or ""), cand.get("generationLane"))
    template_digest = cand.get("promptTemplateDigest")
    if not template_digest:
        raise MissingRecipe(
            f"mixed row {rec_id!r} records no mixing template digest. The template "
            "that produced it is not recoverable from the row, and taking whichever "
            "template make_mixed.py holds today would attach a recipe this row "
            "cannot support — the pool was written before the digest was persisted"
        )
    recipe = str(cand.get("promptTemplateId") or "mixed")
    # `domainSource` must be `known` in EVERY class: the stratum a row is counted
    # under is decided by our own extraction, so `unknown` there is a defect in a
    # pipeline we control rather than an unrecoverable gap in the world (schema.ts
    # AXIS_STATE_RULE says exactly that). `make_mixed.emit` writes "?" when the parent
    # row carried no family, and "?" normalises to nothing — so it is refused HERE with
    # a message naming the cause, instead of surfacing as a bare ValueError out of
    # axis_token halfway through an assembly.
    parent_family = str(cand.get("parentFamily") or "")
    if not parent_family or parent_family == "?":
        raise MissingRecipe(
            f"mixed row {rec_id!r} names no parent family (parentFamily="
            f"{cand.get('parentFamily')!r}), so it has no domainSource stratum to be "
            "counted under. The parent's family is on the parent row; re-emit the pair "
            "from a parents file that carries it"
        )
    if parent_family not in REGISTER:
        raise OutOfFrameDomainSource(
            f"mixed row {rec_id!r} was mixed from a parent of the domainSource "
            f"{parent_family!r}, which is outside the declared frame: "
            f"{out_of_frame_reason(parent_family)}. A mechanistic mixed row IS its "
            "parent's human text with generated stretches, so it is counted in the "
            "parent's cell, and that cell does not exist. Admissible: "
            f"{', '.join(sorted(REGISTER))}"
        )
    # A mechanistic mixed row IS a human text with generated stretches, so the material
    # it depends on is the PARENT's material — and the axis rule admits only `known`
    # here, so there is no eligibility-priced escape. The pair row carries the parent's
    # batch; a value derived here would claim an acquisition event this row never had.
    material_batch = str(cand.get("sourceMaterialBatch") or "")
    if not material_batch:
        raise MissingMaterialBatch(
            f"mixed row {rec_id!r} names no sourceMaterialBatch. The material is the "
            "parent's, so the pair file has to carry the parent's batch; the parent id "
            "alone does not resolve an acquisition event at assembly time"
        )
    rec = {
        "schemaVersion": 4,
        "id": rec_id,
        "text": text,
        "label": "mixed",
        "language": "pt-BR",
        "platform": "generic",
        "domain": "geral",
        "topic": "geral",
        "wordCount": len(text.split()),
        "provenance": {
            "sourceKind": "controlled-generation",
            "sourceId": "src_mixed",
            "sourceRevision": "rev_001",
            "licenseId": license_id,
            "legalBasis": "generated",
        },
        "review": review_state(),
        "mixture": {
            "aiFraction": ai_fraction,
            "humanFraction": 1.0 - ai_fraction,
            "spans": [
                {"start": int(s["start"]), "end": int(s["end"]), "origin": s["origin"]}
                for s in spans
            ],
            # A FACT here and not a default: make_mixed.py chose and executed the
            # edits, so the provenance of every span is known while the coauthorship
            # distribution is ours. "ecological" would claim an observed writing
            # process this lane never watched, and this assembler must never write
            # it (R4).
            "generationMode": MECHANISTIC_GENERATION_MODE,
        },
        # The AI spans ARE controlled generation, and a mechanistic mixed row's
        # recipe is ours, so the schema requires it on the row.
        "generation": {
            "provider": str(cand.get("provider") or "reserved"),
            "family": model,
            "model": model,
            "version": model,
            "promptId": slug(f"{recipe}_{parent}"),
            "promptSha256": str(template_digest),
            "promptTemplateDigest": str(template_digest),
            "decoding": decoding_config(lane, cand),
            "effort": effort_config(lane, cand),
            **seed_pair(cand),
        },
        "transformation": {"kind": "human-ai-mix", "severity": "medium"},
        "groups": {
            # A mixed row IS a human text with generated stretches, so its human
            # author and origin document are real. The pools do not carry them (the
            # pairs files record only the parent id), so they are `unknown` and
            # inherited from the parent by C3 rather than fabricated here.
            "author": group_axes.unknown(
                "the mixing pools record only the parent id; the parent's author "
                "axis is resolved through groups.derivationRoot, not copied here"
            ),
            "source": group_axes.unknown(
                "the mixing pools record only the parent id; the parent's origin "
                "document is resolved through groups.derivationRoot"
            ),
            "domainSource": group_axes.known(group_axes.axis_token(parent_family)),
            # BOTH known, and both the same row: a mechanistic mixed record is built
            # by editing one specific human text, so that text is its seed AND the
            # thing it derives from. This is the lineage requirement 5 asks for, and
            # it is what keeps the whole seed -> generation -> derivative tree in one
            # partition once C3/E2 impose it.
            "humanSeed": group_axes.known(parent),
            "derivationRoot": group_axes.known(parent),
            **generation_axes(lane, model, model, recipe, str(template_digest), cand),
            "sourceMaterialBatch": group_axes.known(
                group_axes.axis_token(material_batch)
            ),
            "generationBatch": group_axes.unknown(
                "the generation batch is derived after partitioning"
            ),
            # No extractor read this row out of a source document: it was written by
            # editing a parent row that an extractor had already produced.
            "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
            "nearDuplicate": near_duplicate_axis(rec_id),
        },
    }
    return rec


# recordId -> the partition its block time places it in. A SIDE map and not a field:
# the record's key set is closed and `partition` is not one of its keys, and the
# partition is a DERIVED fact (which block `createdAt` falls in) that would become a
# second copy able to disagree with the timestamp if it were stored on the record.
PARTITION_OF: dict[str, str] = {}


def stamp_block(rec: dict, partition: str) -> dict:
    """Fills every *At timestamp with the partition's block time."""
    PARTITION_OF[rec["id"]] = partition
    t = BLOCK_TIME[partition]
    rec["createdAt"] = t
    rec["provenance"]["collectedAt"] = t
    if "generation" in rec:
        rec["generation"]["generatedAt"] = t
    return rec


def thin_held_out_families(
    records: list[dict], held_out: set[str], minimum: int = HELD_OUT_MINIMUM
) -> dict[str, int]:
    """Declared held-out families the WRITTEN corpus does not actually stock.

    Counts `groups.generatorFamily` — the SAME canonical field `held_out` is built
    from. It used to count `generation.family`, the provider's own dotted label
    (`gemini-3.5-flash-low`), and test membership in a set of canonical underscored
    tokens (`gemini-3_5-flash-low`): a comparison that could not match whatever the
    counts were, so this warning was silent by construction. Same defect class as
    the `generatorExposure` slice and the splitter's held-out mark (A4).

    It also iterates `held_out` rather than the Counter's keys, so a family that is
    declared unseen and stocked by NO record at all is reported as 0 instead of
    vanishing from the report — that is the worst case for a held-out claim, not an
    absence of one.

    Same QUESTION as `below_floor` in main(), asked at the other end: that one asks
    it of the declaration candidates, this one of the records actually written, after
    partitioning. So it has to count the same thing — POSITIVES (`ai` + `mixed`),
    which is what `validate` puts the 200-record floor on
    (DATASET_COVERAGE_INVALID). Counting record-lines of any label instead would give
    the two sides different denominators while the docstring claimed they agree, and
    a family padded to the floor by rows that are not positives would pass here and
    be refused by `validate`. The value of asking twice is catching a later edit that
    prunes records after the declaration loop, or relaxes the floor.
    """
    # `identity_of` and not a bare read: since C2 an axis is an object carrying a
    # state, and `.get("generatorFamily")` would compare a dict against a set of
    # strings and silently match nothing — the same defect class A4 fixed here, in a
    # new spelling. It reads the v2 string shape too, so this counter still works
    # against a v2 corpus on disk.
    written = Counter(
        group_axes.identity_of((r.get("groups") or {}).get("generatorFamily"))
        for r in records
        if r.get("label") in ("ai", "mixed")
    )
    return {f: written[f] for f in sorted(held_out) if written[f] < minimum}


# --- the reserve: which families the training set may contain ------------------


class SlateContradiction(RuntimeError):
    """The slate's own declarations disagree, so no corpus built from it can be right."""


class UndeclaredGeneratorFamily(RuntimeError):
    """A generated family no role of the slate names.

    Stops the run instead of being counted as a drop, like `UndecidedDomainSource`: the
    three lists ARE the decision, so a name outside all of them is undecided, and the case
    that makes it matter is a reserved family renamed by its provider. Classifying it by
    anything other than the declaration — a prefix, a lane, a default — puts a RESERVED
    family in `train` and reports nothing. It is also the guard that makes the reserve's
    second lineage impossible to forget: the day its lines exist with no role naming
    them, this halts instead of training on them.
    """


class ReserveFillsTheBlindBlock(RuntimeError):
    """The reserved rows of one class do not leave room for a core positive in `test`.

    The blind block carries TWO hypotheses at once: recall at the published threshold,
    measured over positives of families the training set contains, and the unseen-
    generator slice, measured over the reserve. A reserve that fills the block leaves the
    first with no population, and the assembler must not choose which reserved lines to
    discard to make room — how much of each role the block holds is a collection quota.
    """


class HeldOutReserveEmpty(RuntimeError):
    """No family can be declared held-out, and no family may be substituted for one."""


def slate_roles() -> dict[str, str]:
    """family -> role, over the three declared lists. The only place they are joined."""
    return {
        **{family: OOD_RESERVED_ROLE for family in OOD_RESERVED_FAMILIES},
        **{family: CORE_ROLE for family in CORE_GENERATOR_FAMILIES},
        **{family: EXCLUDED_ROLE for family in EXCLUDED_GENERATOR_FAMILIES},
    }


def assert_slate_roles_are_consistent() -> None:
    """The slate decides each family once, in the spelling the records carry.

    Five ways the lists can be written so that nothing they say can hold, all of
    them silent at assembly time: a family in two roles (the corpus would be seated by
    whichever lookup runs first), a reserved family whose held-out claim was already
    withdrawn (`HELD_OUT_INELIGIBLE` — declaring it measures a generator the training set
    saw), a name that is not a `generator_family` fixed point (the dotted provider
    spelling never equals `groups.generatorFamily`, so the role never applies), a family
    the pools deliver and no role names, and a role naming a family the pools do not
    deliver.

    The last two are what make the coverage a guard. A pool family with no role is a
    decision nobody took, and it surfaces only if and when a row of it survives its
    metadata — which is to say after the re-extraction, under pressure to unblock. A role
    naming an absent family is the reverse: it reads as coverage the pools never had, and
    it is how a list written from the slate came to look like a list written from the
    pools.
    """
    roles: dict[str, list[str]] = {}
    for role, names in (
        (OOD_RESERVED_ROLE, OOD_RESERVED_FAMILIES),
        (CORE_ROLE, CORE_GENERATOR_FAMILIES),
        (EXCLUDED_ROLE, EXCLUDED_GENERATOR_FAMILIES),
    ):
        for family in names:
            roles.setdefault(family, []).append(role)
    doubled = {f: sorted(r) for f, r in sorted(roles.items()) if len(r) > 1}
    if doubled:
        raise SlateContradiction(
            f"the slate declares {doubled}: one family cannot hold two roles, and which "
            "one applies would be decided by whichever lookup runs first"
        )
    withdrawn = sorted(set(OOD_RESERVED_FAMILIES) & HELD_OUT_INELIGIBLE)
    if withdrawn:
        raise SlateContradiction(
            f"the slate reserves {withdrawn}, whose held-out claim was withdrawn as "
            "unprovable (HELD_OUT_INELIGIBLE): reserving it would publish an unseen-"
            "generator result for a generator the training set may well have seen"
        )
    for family in sorted(roles):
        canonical = generator_family(family)
        if canonical != family:
            raise SlateContradiction(
                f"the slate names {family!r}, whose canonical form is {canonical!r}: "
                "groups.generatorFamily carries the canonical spelling, so this role "
                "would never match any record"
            )
    # The PENDING half of the reserve, checked BEFORE the two coverage rules below and
    # not after: both of those would fire first with their generic message, and the
    # specific one is the whole value here — "declare it ood-reserved, that is what it
    # was ratified as" is actionable where "a family with no role" is a puzzle.
    for family in sorted(RATIFIED_PENDING_RESERVE):
        canonical = generator_family(family)
        if canonical != family:
            raise SlateContradiction(
                f"the pending reserve names {family!r}, whose canonical form is "
                f"{canonical!r}: the day it is promoted the role would never match a "
                "record, and the promotion is exactly when nobody is looking at spelling"
            )
    materialized = sorted(set(RATIFIED_PENDING_RESERVE) & set(POOL_GENERATOR_FAMILIES))
    if materialized:
        raise SlateContradiction(
            f"the pools now deliver {materialized}, which RATIFIED_PENDING_RESERVE still "
            f"calls pending. Declare it {OOD_RESERVED_ROLE} — that is what it was "
            "ratified as — and take it out of the pending list: a reserved lineage whose "
            "lines exist while nothing places them is the one state that ends with a "
            "reserved family in `train`"
        )
    decided = sorted(set(RATIFIED_PENDING_RESERVE) & set(roles))
    if decided:
        raise SlateContradiction(
            f"{decided} is both pending and roled: a family cannot be waiting for its "
            "material and already placed by the slate. Take it out of "
            "RATIFIED_PENDING_RESERVE when its role is declared"
        )
    unroled = sorted(set(POOL_GENERATOR_FAMILIES) - set(roles))
    if unroled:
        raise SlateContradiction(
            f"POOL_GENERATOR_FAMILIES delivers {unroled} and no role of the slate names "
            f"them. Declare each one {OOD_RESERVED_ROLE}, {CORE_ROLE} or {EXCLUDED_ROLE}: "
            "a family with no role is a decision that gets taken by whoever is "
            "unblocking a run"
        )
    unpooled = sorted(set(roles) - set(POOL_GENERATOR_FAMILIES))
    if unpooled:
        raise SlateContradiction(
            f"the slate names {unpooled} and the measured pool census does not deliver "
            "them. Either the pools changed — re-measure POOL_GENERATOR_FAMILIES — or the "
            "role is coverage of nothing, which is how the lists came to look derived "
            "from the pools when they were written from the generation slate"
        )


def slate_role_of(family: str, record_id: str) -> str:
    """The declared role of one canonical family, or a refusal in place of a default."""
    role = slate_roles().get(family)
    if role is not None:
        return role
    raise UndeclaredGeneratorFamily(
        f"the record {record_id!r} was generated by the family {family!r}, which "
        f"the slate declares neither {OOD_RESERVED_ROLE} "
        f"({', '.join(sorted(OOD_RESERVED_FAMILIES))}) nor {CORE_ROLE} "
        f"({', '.join(sorted(CORE_GENERATOR_FAMILIES))}) nor {EXCLUDED_ROLE} "
        f"({', '.join(sorted(EXCLUDED_GENERATOR_FAMILIES))}). Declare it in one of "
        "the three before assembling: a family classified by anything but the "
        "declaration is how a renamed reserved family enters training in silence"
    )


def generator_family_roles(records: list[dict]) -> dict[str, str]:
    """Every generated family in the corpus -> its declared role.

    Reads `groups.generatorFamily`, the canonical axis, and not `generation.family`: the
    latter carries the provider's dotted label, which never equals a slate entry, so a
    role looked up through it silently applies to nothing.
    """
    roles: dict[str, str] = {}
    for rec in records:
        if rec.get("label") not in ("ai", "mixed"):
            continue
        family = group_axes.identity_of((rec.get("groups") or {}).get("generatorFamily"))
        if family is None:
            continue
        roles[family] = slate_role_of(family, str(rec["id"]))
    return roles


def drop_excluded_families(
    records: list[dict], roles: dict[str, str]
) -> tuple[list[dict], dict[str, int]]:
    """(records the slate admits, rows dropped per excluded family).

    Separate from the role pass because the count is the output: these rows were selected
    against the class quota and left the corpus for a reason no re-extraction repairs, so
    the number is what a regeneration has to replace.
    """
    excluded = {family for family, role in roles.items() if role == EXCLUDED_ROLE}
    if not excluded:
        return records, {}
    dropped: Counter = Counter()
    kept: list[dict] = []
    for rec in records:
        family = group_axes.identity_of((rec.get("groups") or {}).get("generatorFamily"))
        if family in excluded:
            dropped[family] += 1
        else:
            kept.append(rec)
    return kept, dict(sorted(dropped.items()))


def reserved_rows_per_class(
    per_family: dict[str, Counter], reserved: Iterable[str]
) -> dict[str, int]:
    """Reserved rows per record class, which is the unit the blind block is sized in."""
    rows: Counter = Counter()
    for family in reserved:
        rows.update(per_family[family])
    return dict(rows)


def assert_the_blind_block_holds_both_roles(
    reserved_rows: dict[str, int], test_capacity: dict[str, int]
) -> None:
    """The reserve fits in `test` AND leaves at least one core positive beside it."""
    for label in sorted(reserved_rows):
        capacity = test_capacity.get(label, 0)
        if reserved_rows[label] >= capacity:
            raise ReserveFillsTheBlindBlock(
                f"the class {label!r} carries {reserved_rows[label]} reserved rows and "
                f"its test block holds {capacity}: the reserve has to be strictly "
                "smaller, or the blind block publishes an unseen-generator slice with no "
                "core positive to read recall on. Generate fewer reserved lines or more "
                "core ones — the assembler will not pick which reserved lines to discard"
            )


def positive_rows_per_family(records: list[dict]) -> dict[str, Counter]:
    """family -> {label: rows}, over the ai/mixed LINES of the corpus.

    The population the reserve floor and the blind-block arithmetic are both read from,
    named once so the two cannot count different things. It counts LINES: see
    `reserved_families_below_the_recall_floor` for why it is not the sealed side's
    eligible-rows population, and for the direction the difference errs in.
    """
    per_family: dict[str, Counter] = {}
    for rec in records:
        family = group_axes.identity_of((rec.get("groups") or {}).get("generatorFamily"))
        if family and rec["label"] in ("ai", "mixed"):
            per_family.setdefault(family, Counter())[rec["label"]] += 1
    return per_family


def reserved_families_below_the_recall_floor(
    positives: dict[str, int], reserved: Iterable[str], minimum: int = HELD_OUT_MINIMUM
) -> dict[str, int]:
    """Reserved families too thin to be DECLARED, whose lines therefore leave the corpus.

    `validate` refuses a declared held-out family with fewer than `minimum` positives
    (DATASET_COVERAGE_INVALID), and a reserved family may not enter training, so a thin
    reserve has exactly one admissible outcome: its lines are dropped and counted. The
    count is what a regeneration has to close.

    WHICH POPULATION IS COUNTED, because it is not the same one `validate` counts. Here it
    is every ai/mixed LINE of the family. The sealed floor counts `positiveRows.filter(
    countsTowardHeldOutFloor)` (benchmark/dataset-manifest.ts), which on a v4 corpus is the
    ELIGIBLE rows — no axis left `unknown` — so the sealed side is the stricter of the two
    and this one is an upper bound. A family with 260 lines of which 180 are eligible
    passes here and is refused by `sealDataset`.

    The lab does not mirror eligibility, and the reason is a measured one rather than a
    preference: at this point in the run `groups.generationBatch` is `unknown` on every
    generated row by construction — `assign_generation_batches` fills it after
    partitioning, because `generatedAt` is part of the batch key — so an eligibility count
    taken here returns zero for every family. Mirroring it would mean a second, partial
    copy of the sealed rule (eligibility minus the axes not yet filled), which is the
    "two spellings that never meet" defect the sealed module is itself annotated for.
    `harnessVersion` is the axis that makes the two counts genuinely differ on today's
    pools: the CLI lanes never captured it, so those rows are ineligible at seal time.
    """
    return {
        family: positives[family]
        for family in sorted(reserved)
        if positives[family] < minimum
    }


def declared_held_out_families(
    seated: Iterable[str], withdrawn: dict[str, str]
) -> list[str]:
    """`heldOutGeneratorFamilies` for the governance, or a refusal in its place.

    `parseDatasetManifest` (benchmark/dataset-manifest.ts) refuses a manifest whose list
    is empty, so "no reserve" is not a state the governance can express — and the one
    thing that must never fill the gap is a family name, because every candidate the run
    withdrew was withdrawn for a reason that still holds. The refusal carries those
    reasons: they are what has to be acted on.
    """
    families = sorted(seated)
    if families:
        return families
    detail = (
        "; ".join(f"{family}: {reason}" for family, reason in sorted(withdrawn.items()))
        or "no generated family of the slate's reserve reached the corpus at all"
    )
    raise HeldOutReserveEmpty(
        "no generator family can be declared held-out, and the sealed manifest refuses "
        f"an empty list, so this corpus supports no unseen-generator claim ({detail}). "
        "Regenerate the reserved lane or amend the slate; naming a family here would "
        "reinstate a claim this run withdrew"
    )


# --- the seen set: the dead corpus, as an artifact nobody has to read -----------
#
# The screen is against the WHOLE dead corpus — all 10.000 record-lines, every partition —
# and the prune is GLOBAL: a candidate that matches leaves the corpus rather than being
# barred from the blind partitions. That is a superset of the graduated exposure rule
# (ESTADO.md § 3.4), which would readmit a matching line into `train`, `dev` and `cal-A`;
# the ~1.600 recoverable lines are given up so that "nothing in this corpus was seen" is
# one comparison instead of a per-partition argument.
#
# The assembler reads the ARTIFACT and never the corpus: part of those 10.000 lines sat in
# a blind partition, and the artifact carries only digests and shingle keys
# (near_dupes.SeenIndex). Build it with
#   py -3.13 near_dupes.py build-seen-index --records <dead corpus> --out <artifact>
SEEN_INDEX_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "seen-index.v2.jsonl"
)
# The dead corpus is a frozen artifact of the reproved run: this many record-lines, and
# these bytes. Both are conferred against the artifact's header, and the digest is the
# half that says WHICH corpus was screened — a count alone is satisfied by any file with
# enough lines, including the fresh candidate pools (13.880 rows on disk today), and an
# index built over those would let the run print its contamination number having
# compared the pools against themselves. The digest lives here as a CONSTANT rather than
# as prose in a comment for the same reason: a measurement nothing compares is folklore.
DEAD_CORPUS_DOCUMENTS = 10_000
DEAD_CORPUS_SHA256 = "595739107e895cfc7b09409f29c13b998d195e921f1ca7eec1e5c8406772116a"


class SeenIndexMissing(RuntimeError):
    """No seen-set artifact, so the global prune cannot run.

    A release assembly REFUSES rather than skipping the prune: a corpus assembled with no
    screen at all is indistinguishable, from its own artifacts, from one that passed the
    screen, so the absence has to stop the run instead of being absorbed by it.
    """


class SeenIndexIncomplete(RuntimeError):
    """The artifact covers fewer documents than the dead corpus has."""


class SeenIndexOfAnotherCorpus(RuntimeError):
    """The artifact was built over a file that is not the dead corpus.

    Same failure mode as `SeenIndexMissing` and indistinguishable from a clean run by the
    artifacts either produces: the screen ran, reported, and answered about the wrong
    material.
    """


def assert_the_seen_index_covers_the_dead_corpus(
    header: dict,
    documents: int = DEAD_CORPUS_DOCUMENTS,
    digest: str = DEAD_CORPUS_SHA256,
) -> None:
    source = header.get("source") or {}
    covered = int(header.get("documents") or 0)
    if covered < documents:
        raise SeenIndexIncomplete(
            f"the seen-set artifact covers {covered} documents and the dead corpus has "
            f"{documents} (built from {source.get('path')!r}). The prune is declared over "
            "the whole dead corpus, so a partial index leaves part of it unscreened while "
            "the run reports a clean pool"
        )
    built_over = str(source.get("sha256") or "")
    if built_over != digest:
        raise SeenIndexOfAnotherCorpus(
            f"the seen-set artifact was built over sha256 {built_over!r} "
            f"({source.get('path')!r}) and the dead corpus is {digest!r}. The count of "
            "documents does not identify the material: rebuild the artifact from the "
            "dead corpus, or the run screens the pools against the wrong file and "
            "publishes the number as contamination"
        )


class UnsplittableCorpus(RuntimeError):
    """A stamped corpus the connected splitter cannot honor."""


# The two union relations of `connectedComponentRoots` (benchmark/split.ts), mirrored.
# They are DIFFERENT relations and the distinction is the whole point:
#
#   * SHARED VALUE (`GROUP_KEYS`): two record-lines carrying the same identity here are
#     always one component. `generatorFamily` is NOT in this list, e nem `generatorVersion`,
#     que carrega a identidade dela em toda linha montada (medido, 1170/1170,
#     `GeneratorVersionIsTheFamilyTests`) — entao a familia de gerador e de facto DIVISIVEL
#     aqui, e o que a constrange e a reserva OOD, que e outro mecanismo.
#   * PARENT LINKAGE (`PARENT_LINKAGE_AXES`): a record-line whose identity NAMES ANOTHER
#     record-line's id joins that row, and only when the named row is present. Naming
#     itself unions nothing.
#
# A LISTA TEM CRITERIO, e o criterio e condicao NECESSARIA — nunca definicao. Todo eixo
# daqui cumpre ao menos uma de
#
#   (a) ele identifica MATERIAL — e membro de `EXPOSURE_IDENTITY_AXES`
#       (benchmark/cluster-exposure-ledger.ts), a lista pela qual o ledger decide que a
#       mesma UNIDADE DE AMOSTRAGEM reapareceu —, ou
#   (b) a uniao por ele e INERTE sobre o corpo montado, que e medicao e nao argumento: o
#       corpo tem o mesmo numero de componentes com o eixo na lista e sem ele, ou
#   (c) o eixo modela uma dependencia que um membro da FAMILIA CERTIFICADORA e medido
#       sobre, e unir por ele e VIAVEL porque o corpo e CONSTRUIDO para que seja.
#
# AS TRES PERNAS NAO SAO SIMETRICAS. (a) e uma lista que outro gate ja executa; (b) e uma
# medicao sobre um corpo, e o ESCOPO viaja com a alegacao; (c) e uma RESTRICAO DE COLETA,
# a unica que pode ser cumprida hoje e falsificada amanha por uma corrida de geracao que
# ignorou o plano — e e por isso que a verificacao dela morde ANTES da geracao
# (`island_plan`, o `type=` de `--island` em generate_ai.py) e outra vez aqui.
#
# `author`, `source` e `derivationRoot` entram por (a). `nearDuplicate` e
# `generationBatch` entram por (b): depois da poda `nearDuplicate` e o proprio id da
# linha (1170 identidades sobre as 1170 linhas geradas montadas), e o lote esta CONTIDO
# no template SOB A FORMA QUE O MONTADOR PRODUZ. A contencao NAO e incondicional, e a
# excecao e alcancavel: a identidade de `promptTemplate` e `{recipe}_{digest[:16]}` e o nome
# da receita NAO esta na chave do lote, entao duas linhas do mesmo digest com `recipe`
# diferente caem em UM lote e em DUAS identidades de template — e sobre esse corpo o lote
# NAO e inerte. O fundamento que vale e o de sempre: `stamp_block` sobrescreve `generatedAt`,
# e e `test_a_batch_never_straddles_two_partitions` que o prende.
#
# `promptTemplate` e o UNICO que entra por (c): o recall que o release certifica reamostra
# por familia -> template -> lote, entao o splitter tem de MODELAR a dependencia de prompt
# ou o recall e medido sobre prompts que o treino viu.
#
# A RECIPROCA E FALSA, e quatro eixos deste mesmo esquema a refutam:
#
#   * `humanSeed` cumpre (a) — o ledger o executa como identidade de material — e NAO
#     esta aqui. Esta em `SPLIT_PARENT_LINKAGE_AXES`, porque a identidade dele nomeia o
#     ID DE OUTRA LINHA e nao um valor que duas linhas compartilham. Lido como
#     bicondicional, o criterio conclui que ele deve entrar nesta lista — a mudanca que o
#     contrato recusou;
#   * `extractionRun` cumpre (b) sobre o corpo que existe, e vacuamente: e `notApplicable`
#     em toda linha gerada, entao unir por ele nao une nada e a contagem de componentes
#     nao muda. E tambem NAO esta aqui, por uma razao que (b) nao ve: reextrair o mesmo
#     dump nao produz material novo, entao unir por ele contaria uma dependencia duas
#     vezes. Ele e DIAGNOSTICO, e quem o nomeia assim e `connectivity.diagnosticAxes` da
#     pre-inscricao. O ESCOPO da medicao importa: sobre um corpo com linha HUMANA o mesmo
#     eixo NAO e inerte, porque uma extracao escreve milhares de linhas com o mesmo id de
#     execucao — medido em `test_a_reciproca_do_criterio_e_FALSA_nos_dois_sentidos`. A
#     perna (b) e propriedade do corpo medido, nunca licenca para unir;
#   * `generatorFamily` cumpre (c) — e o nivel de TOPO de `ai-recall` — e NAO esta aqui,
#     por uma razao que (c) nao ve: ele e `inventoryOnly`, e o que a arvore faz por ele e
#     mais estreito que agrupar (so as familias RESERVADAS sao constrangidas, e so a serem
#     de `test`);
#   * `generatorVersion` cumpre (c) na forma mais forte disponivel — a identidade dele E a
#     da familia em 1170 de 1170 linhas montadas, entao ele carrega o nivel de topo da
#     arvore de reamostragem — e NAO esta aqui, por uma razao que (c) tambem nao ve: se a
#     obrigacao pode ser IMPOSTA em sitio algum. Duas medicoes dizem que nao pode e que nao
#     e preciso. A identidade de versao que uma corrida grava e o ID DO MODELO — o mesmo
#     teste recusa toda linha montada em que `version` difere de `family` —, entao espalhar
#     a versao pelas 20 ilhas de um plano conforme pediria 20 ids de modelo distintos, e os
#     pools montados carregam CINCO identidades de versao nas 1170 linhas geradas; e unir por
#     ela nao e o que a granularidade precisa,
#     porque sozinha sobre os pools ela deixa 5 componentes com o maior em 493 linhas
#     (42,14 % da classe), que CABE. Ele e `namedReported`, e o RESIDUO fica declarado: a
#     CO-LOCACAO de versao nao e modelada, duas linhas da mesma versao podem cair em
#     particoes diferentes, e a perna de novidade de gerador e a reserva OOD por familia
#     (`OOD_RESERVED_FAMILIES`), que constrange as familias reservadas a serem de `test`.
#
# Logo a SITUACAO de um eixo e decidida por quatro listas e nunca por (a)/(b)/(c) sozinhas:
# uniao por valor (esta), linhagem de pai (`SPLIT_PARENT_LINKAGE_AXES`), reportado
# (`REPORTED_GROUP_AXES`, tres nomes) e diagnostico (`extractionRun`). AS QUATRO NAO
# COBREM OS CATORZE: `generatorFamily`, `generationLane` e `harnessVersion` — e
# `collectionBatch`, que so v3 declara — ficam de fora de todas, e o que eles tem e o
# inventario por particao da auditoria. `groupAxisRole` (benchmark/split-audit.ts) e a
# funcao total sobre os catorze, e o residuo esta declarado la.
#
# O QUE A PERNA (c) CUSTA, e o preco e pago na COLETA e nao no relato. A aritmetica e
# medida nas 1170 linhas montadas: o maior `promptTemplate` vale 641/1170 = 54,79% da
# classe gerada num unico componente, acima do maior alvo mais a tolerancia. Essa recusa nao
# e argumento para excluir o eixo — e o TAMANHO da obrigacao que (c) impoe, e e ele que fixa
# a granularidade de um corpo conforme. Uma classe gerada produzida como aqueles pools foram
# produzidos e RECUSADA por `assert_components_can_fill_five_partitions`, pelo ramo do maior
# componente, e o corpo tem de ser CONSTRUIDO em ILHAS: cada bloco de material humano leva os
# seus templates, as suas sementes e os pais das suas linhas mistas, de modo que o grafo de
# templates seja um conjunto de ilhas desconexas. `ISLAND_PLAN` declara essa geometria e
# `island_plan` a recusa antes da cota.
#
# E O PRECO EM TEMPLATES, na unidade em que o operador paga: nenhuma identidade de template
# em duas ilhas, entao um plano de N ilhas pede N templates DISTINTOS no minimo. O preflight
# recusa menos de 15 ilhas (um componente de um plano de 14 vale 7,14 % do corpo contra o
# teto de 7 % de `dev`), entao o piso de qualquer plano conforme e 15 templates; `ISLAND_PLAN`
# declara 20 ilhas de dois templates cada e pede 40. Escrever prompt e o eixo barato — e e por
# isso que esta lista leva o template e nao a versao, cujo particionamento custaria um modelo
# por ilha.
#
# `domainSource` e `sourceMaterialBatch` falham a perna (a), e falham a (b) SOBRE UM CORPO
# QUE TEM LINHA HUMANA — que e o escopo em que a (b) e medida, e isso precisa ser dito:
# sobre o corpo todo-gerado os dois sao `notApplicable` em toda linha e sao inertes la pela
# mesma razao vacuosa que `extractionRun`. A falha e aritmetica e nao
# gosto: ha UM evento de aquisicao por fonte e um estrato por celula de quota, entao
# qualquer um dos dois une a celula inteira num componente indivisivel. A moldura declara
# UMA celula, entao esse componente E a classe `human` inteira: fracao de 100% dela, `dev`
# de 0,05 inalcancavel, a recusa saindo pelo ramo do MAIOR componente, e um piso contado em
# componentes lendo 1 por celula para sempre.
#
# A aritmetica de quatro celulas — fracoes humanas em multiplos de ~25% — e CONTRAFACTUAL:
# moldura nenhuma declara quatro. Ela fica porque E o argumento, nao um exemplo dele: mais
# celulas suavizam as fracoes sem reparar nenhuma, entao os dois eixos ficam fora da uniao em
# qualquer moldura. O RAMO da recusa muda com n, porem. Com n celulas a fracao e 1/n: em
# n = 2 ela ainda excede o maior alvo mais a tolerancia (0,47) e a recusa e a do maior; de
# n = 3 a n = 14 ela cabe no maior e excede o menor alvo mais a tolerancia (0,07), entao a
# recusa passa a ser a do MENOR componente; em n = 15 (6,67%) este preflight nao recusa mais.
# Nao recusar NAO e viabilidade: `assert_components_can_fill_five_partitions` decide duas
# condicoes NECESSARIAS e declara que a atribuicao completa e soma de subconjuntos.
#
# Both lists are a COPY of the ones benchmark/split.ts declares, and a copy that drifts accepts
# an axis the splitter unions on or refuses one it ignores.
SPLIT_GROUP_KEYS: tuple[str, ...] = (
    "author",
    "source",
    "promptTemplate",
    "generationBatch",
    "nearDuplicate",
    "derivationRoot",
)

SPLIT_PARENT_LINKAGE_AXES: tuple[str, ...] = ("derivationRoot", "humanSeed")


def connected_components(records: list[dict]) -> dict[str, str]:
    """Every record id -> its component root, by the splitter's own two relations.

    Union-find with transitive closure, because a chain seed -> generation -> derivative is
    ONE component even though no single axis links its ends.
    """
    parent: dict[str, str] = {rec["id"]: rec["id"] for rec in records}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for axis in SPLIT_GROUP_KEYS:
        first_by_value: dict[str, str] = {}
        for rec in records:
            identity = group_axes.identity_of((rec.get("groups") or {}).get(axis))
            if identity is None:
                continue
            seen = first_by_value.get(identity)
            if seen is None:
                first_by_value[identity] = rec["id"]
            else:
                union(seen, rec["id"])

    ids = {rec["id"] for rec in records}
    for rec in records:
        for axis in SPLIT_PARENT_LINKAGE_AXES:
            named = group_axes.identity_of((rec.get("groups") or {}).get(axis))
            if named is not None and named != rec["id"] and named in ids:
                union(rec["id"], named)

    return {rec["id"]: find(rec["id"]) for rec in records}


def declared_group_axes(corpo_injetado: str | None = None) -> dict[str, tuple[str, ...]]:
    """`provenance.sourceId` -> the axes that source DECLARED applicable.

    Read from `benchmark/source-manifest.ts`, the same frozen inventory the audit joins
    against, instead of restated here: a second spelling of the join would let this side
    accept an axis the audit refuses.
    """
    if corpo_injetado is not None:
        # Só os testes injetam. Existe porque provar que o parse falha fechado exige um corpo
        # malformado, e um teste que apenas chama a função contra o arquivo atual não prova nada.
        fonte = corpo_injetado
    else:
        fonte = (
            Path(__file__).resolve().parent.parent / "source-manifest.ts"
        ).read_text(encoding="utf-8")
    # SOMENTE o corpo de `V3_HUMAN_SOURCE_INVENTORY`, que e a autoridade que a auditoria
    # usa. Varrer o arquivo inteiro colhe tambem `A1_BLOCKED_HUMAN_SOURCES` — foi medido
    # trazendo `src_ptso`, que esta BLOQUEADO — e uma autoridade com fonte a mais aceita
    # linha que a auditoria recusa.
    marcador = "export const V3_HUMAN_SOURCE_INVENTORY"
    if marcador not in fonte:
        raise RuntimeError(
            "source-manifest.ts nao expoe V3_HUMAN_SOURCE_INVENTORY: espelho nao pode "
            "adivinhar a autoridade"
        )
    corpo = fonte.split(marcador, 1)[1]
    fim = corpo.find(chr(10) + "];")
    if fim == -1:
        raise RuntimeError(
            "V3_HUMAN_SOURCE_INVENTORY nao termina em ']' reconhecivel: parse incompleto"
        )
    corpo = corpo[:fim]

    por_fonte: dict[str, tuple[str, ...]] = {}
    for source_id, _meio, eixos in re.findall(
        r'sourceId:\s*"([^"]+)"(.*?)declaredGroupAxes:\s*\[([^\]]*)\]',
        corpo,
        re.S,
    ):
        if source_id in por_fonte:
            raise RuntimeError(
                f"{source_id} aparece duas vezes no inventario: espelho ambiguo"
            )
        por_fonte[source_id] = tuple(re.findall(r'"([a-zA-Z]+)"', eixos))

    # CONSUMO COMPLETO, nao "pelo menos uma". Uma entrada malformada faz a regex saltar sobre
    # ela e o mapa volta MENOR, silenciosamente.
    #
    # A contagem que impede isso e das ENTRADAS do array — as aberturas de `{` — e nao dos
    # `sourceId` que a extracao le, porque ela precisa ser mais larga que a extracao para
    # poder recusa-la: cada entrada NAO ANINHADA vale uma abertura, entao toda entrada que a
    # extracao deixou de ler faz a contagem divergir, qualquer que seja a razao — grafia de
    # chave que ela nao le (`"sourceId":`, `'sourceId'`, `sourceId :`, todas TypeScript
    # valido), chave de eixos corrompida, ou entrada que nao nomeia fonte alguma. Contar os
    # `sourceId` da grafia nua nao alcanca as duas ultimas: no MAU-PAREAMENTO o `.*?` da
    # extracao atravessa a entrada seguinte e atribui a PRIMEIRA os eixos da SEGUNDA, com um
    # `sourceId` por par extraido e nenhuma divergencia para notar.
    #
    # O que se garante e isto e nada mais largo: uma entrada que a extracao nao leu faz a
    # funcao levantar. NAO se garante um parse completo como AST — uma entrada com objeto
    # ANINHADO conta duas aberturas e e RECUSADA, que e a direcao fail-fechada e nao uma
    # leitura correta dela. Os nomes da mensagem sao colhidos em qualquer grafia de chave, e
    # so para a mensagem: a decisao e da contagem.
    entradas = corpo.count("{")
    if entradas != len(por_fonte):
        nomeados = re.findall(r'["\']?sourceId["\']?\s*:\s*["\']([^"\']+)["\']', corpo)
        faltando = sorted(set(nomeados) - set(por_fonte))
        raise RuntimeError(
            f"inventario tem {entradas} entrada(s) e o espelho extraiu {len(por_fonte)}: "
            f"parse parcial, faltando {faltando}"
        )
    if not por_fonte:
        raise RuntimeError("nenhuma fonte extraida do inventario: parse falhou fechado")
    return por_fonte


def realized_blocks(records: list[dict]) -> dict[str, str]:
    """Each record id -> the block the SPLITTER will actually place it in.

    A component whose record-lines all carry one stamp keeps that block. One that straddles
    falls through to `train`, because the splitter places a component only when its WHOLE
    time range fits inside a band and `train` is its fallback. So the stamps are a proposal,
    and this is what the proposal becomes.
    """
    roots = connected_components(records)
    block_of_root: dict[str, str] = {}
    for rec in records:
        block = PARTITION_OF.get(rec["id"])
        if block is None:
            continue
        root = roots[rec["id"]]
        seen = block_of_root.get(root)
        if seen is None:
            block_of_root[root] = block
        elif seen != block:
            block_of_root[root] = "train"
    return {
        rec["id"]: block_of_root[roots[rec["id"]]]
        for rec in records
        if rec["id"] in PARTITION_OF
    }


# As cinco frações-alvo do desenho de cinco partições, derivadas de `BLOCK_FRACTIONS`: um alvo
# a menos aqui aceitaria corpo que o splitter recusa.
FIVE_TARGETS: tuple[float, ...] = tuple(BLOCK_FRACTIONS.values())


# O escopo agregado, ao lado de cada classe, e a ORDEM em que os dois são checados.
# Espelham `CORPUS_SCOPE` e `LABEL_REPORT_ORDER` de benchmark/viability-preflight.ts: a guarda
# e o preflight do benchmark recusam pela MESMA condição no MESMO escopo, e o catálogo de
# corpos compartilhado (em `benchmark/tests/fixtures/`, lido pelos dois lados) afirma isso das
# duas pontas. Uma ordem diferente aqui faria os dois discordarem sobre QUAL condição recusa.
CORPUS_SCOPE = "corpus"
LABEL_REPORT_ORDER: tuple[str, ...] = ("human", "ai", "mixed")


def component_fractions_by_scope(
    records: list[dict],
) -> list[tuple[str, int, list[float]]]:
    """(escopo, denominador, frações crescentes) — o corpo, e depois cada classe presente.

    A fração de uma classe é sobre o TOTAL DA CLASSE, que é o denominador que o splitter
    divide por (`classTotals` em benchmark/split.ts), e conta só os componentes que têm linha
    dessa classe: um componente sem linha da classe não contribui e pode ir a qualquer
    partição, então incluí-lo como zero inventaria uma granularidade que não existe.
    """
    raizes = connected_components(records)
    por_escopo: dict[str, dict[str, int]] = {CORPUS_SCOPE: {}}
    for rec in records:
        raiz = raizes[rec["id"]]
        agregado = por_escopo[CORPUS_SCOPE]
        agregado[raiz] = agregado.get(raiz, 0) + 1
        classe = rec["label"]
        if classe not in LABEL_REPORT_ORDER:
            raise UnsplittableCorpus(
                f"registro {rec['id']} tem classe {classe!r}, fora do vocabulário "
                f"{LABEL_REPORT_ORDER}: sem escopo declarado a fração dela não seria checada"
            )
        da_classe = por_escopo.setdefault(classe, {})
        da_classe[raiz] = da_classe.get(raiz, 0) + 1
    ordem = (CORPUS_SCOPE, *LABEL_REPORT_ORDER)
    saida: list[tuple[str, int, list[float]]] = []
    for escopo in sorted(por_escopo, key=ordem.index):
        tamanhos = por_escopo[escopo]
        total = sum(tamanhos.values())
        saida.append((escopo, total, sorted(n / total for n in tamanhos.values())))
    return saida


def assert_components_can_fill_five_partitions(records: list[dict]) -> None:
    """PREFLIGHT: recusa antes da montagem um corpo cujos componentes não podem realizar 45/5/10/20/20.

    O splitter põe o componente conexo INTEIRO numa única partição E compara fração POR CLASSE
    (uma linha de cinco alvos por classe presente, sobre o total daquela classe). Dos dois fatos
    saem duas condições NECESSÁRIAS, e elas valem em TODO escopo — o corpo agregado e cada
    classe:

    1. **Todo componente cabe em alguma partição.** Um componente que vale, num escopo, mais que
       o maior alvo mais a tolerância não tem onde ser posto inteiro.
    2. **Toda partição pode ser preenchida.** Todo alvo excede a tolerância, então toda partição
       tem de receber fração NÃO NULA de todo escopo, e qualquer conjunto de componentes que
       realize o MENOR alvo inclui pelo menos um componente que carrega aquele escopo. Logo o que
       limita é a menor contribuição NÃO NULA, não a maior.

    O ESCOPO DO CORPO não é duplicata dos escopos de classe, nas duas direções: a fração agregada
    de uma partição é a combinação convexa das frações por classe, então ela cai na mesma faixa de
    tolerância e a condição agregada é necessária; mas um corpo cujos componentes são todos
    grossos no agregado, tendo cada classe um componente fino, satisfaz todas as condições por
    classe e ainda assim não preenche a menor partição. Na direção contrária — a caro — uma
    metade gerada fina derruba toda fração agregada, então uma metade humana degenerada em um
    componente por célula passa por um teste só agregado. Num corpo mono-classe os dois escopos
    são a MESMA comparação, e a recusa nomeia os dois.

    | o que este preflight decide            | o que ele NÃO decide                              |
    |----------------------------------------|---------------------------------------------------|
    | as duas condições necessárias acima,   | se existe atribuição completa dos componentes     |
    | no corpo e em cada classe              | às cinco partições — isso é soma de subconjuntos, |
    |                                        | e passar aqui não é garantia de viabilidade. Quem |
    |                                        | tenta a atribuição é `_plano_de_blocos`, e é lá   |
    |                                        | que um componente sem bloco que o receba recusa   |
    | granularidade grosseira demais         | ordenação temporal, precedência de held-out e a   |
    |                                        | realização conjunta das frações por classe, que   |
    |                                        | só um corpo ESTAMPADO determina                   |
    |                                        | (`assert_stamped_corpus_is_splittable`)           |

    Necessária e não suficiente é o que se pode afirmar sem resolver soma de subconjuntos, e
    afirmar mais que isso seria a suposição que a pré-inscrição abandonada fez.
    """
    if not records:
        raise UnsplittableCorpus("corpo vazio: não há componente a distribuir")

    maior_alvo = max(FIVE_TARGETS)
    menor_alvo = min(FIVE_TARGETS)
    limite_max = maior_alvo + CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON
    limite_min = menor_alvo + CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON

    for escopo, total, fracoes in component_fractions_by_scope(records):
        menor, maior = fracoes[0], fracoes[-1]
        onde = "do corpo" if escopo == CORPUS_SCOPE else f'da classe "{escopo}"'

        if maior > limite_max:
            raise UnsplittableCorpus(
                f"o maior componente vale {maior:.4f} {onde} ({total} linha(s)) e o maior "
                f"alvo é {maior_alvo:.2f} (±{CLASS_TOLERANCE}): não há partição que o receba "
                f"inteiro. {len(fracoes)} componente(s), frações {fracoes[:8]}"
            )

        if menor > limite_min:
            raise UnsplittableCorpus(
                f"o MENOR componente vale {menor:.4f} {onde} ({total} linha(s)) e o menor "
                f"alvo é {menor_alvo:.2f} (±{CLASS_TOLERANCE}): nenhum subconjunto não vazio "
                f"realiza a menor partição, porque todo subconjunto inclui ao menos um "
                f"componente. Isto é granularidade, não tamanho de corpo: "
                f"{len(fracoes)} componente(s), frações {fracoes[:8]}"
            )


def assert_stamped_corpus_is_splittable(
    records: list[dict],
    held_out: set[str] | None = None,
    declared: dict[str, tuple[str, ...]] | None = None,
) -> None:
    """Refuse a stamped corpus the splitter or the audit would reject.

    Mirrors the audit's failing conditions that a STAMPED corpus already determines, and all
    of them rather than a subset — checking only one dimension refuses corpora the audit
    accepts, or accepts corpora it rejects, depending on which dimension is missing:

    * per-class fractions within `CLASS_TOLERANCE` of the targets, in all five partitions;
    * `test` strictly newer than each of the other four, INCLUDING `train` — `train` is the
      fallback, so a component straddling the last cut lands there carrying test-period text,
      which is real leakage and the fraction check cannot see it;
    * the three middle partitions ordered earliest-against-latest among themselves, with
      `train` excluded because absorbing straddlers legitimately makes its newest record
      exceed a middle partition's;
    * held-out precedence: the splitter seats a reserved family in `test` regardless of time,
      so a reserved component that realizes anywhere else is a constraint failure, not a
      fraction one;
    * no DECLARED group axis left `unknown`: the source states the dependence exists, and an
      axis nobody recovered cannot support the split.

    The audit refuses on five things, and the decision for each is stated rather than implied:

    | condição da auditoria        | aqui           | por quê                                     |
    |------------------------------|----------------|---------------------------------------------|
    | vazamento de grupo           | NÃO espelhado  | `realized_blocks` põe o componente conexo   |
    |                              |                | INTEIRO numa partição, então vazamento é    |
    |                              |                | impossível por construção nesta simulação   |
    | eixo declarado em `unknown`  | espelhado      | decidível dos registros e do inventário     |
    | `test` estritamente mais novo| espelhado      | decidível dos tempos estampados             |
    | meio ordenado                | espelhado      | idem                                        |
    | frações por classe           | espelhado      | idem                                        |

    Mais a precedência da reserva, que é do splitter e não da auditoria.

    A straddling component is not by itself a defect: it lands in `train`, and whether that
    breaks anything depends on its size and on which bands it spans.
    """
    blocks = realized_blocks(records)
    if not blocks:
        return

    problemas: list[str] = []

    targets = BLOCK_FRACTIONS

    counts: dict[str, dict[str, int]] = {}
    totals: dict[str, int] = {}
    for rec in records:
        block = blocks.get(rec["id"])
        if block is None:
            continue
        label = rec["label"]
        counts.setdefault(label, {})[block] = counts.setdefault(label, {}).get(block, 0) + 1
        totals[label] = totals.get(label, 0) + 1
    for label in sorted(counts):
        for block, alvo in targets.items():
            obtido = counts[label].get(block, 0) / totals[label]
            if not within_class_tolerance(obtido, alvo):
                problemas.append(
                    f"fracao {label}/{block} realiza {obtido:.4f} contra alvo {alvo}"
                )

    # Stamped times, per REALIZED block. A straddling component keeps the times its
    # record-lines were stamped with, so `train` can end up holding a test-band instant.
    tempos: dict[str, list[int]] = {}
    for rec in records:
        block = blocks.get(rec["id"])
        if block is None:
            continue
        tempos.setdefault(block, []).append(int(rec.get("createdAt", 0)))

    def mais_novo(block: str) -> int | None:
        return max(tempos[block]) if tempos.get(block) else None

    def mais_antigo(block: str) -> int | None:
        return min(tempos[block]) if tempos.get(block) else None

    inicio_test = mais_antigo("test")
    if inicio_test is not None:
        for block in ("train", "dev", "cal-A", "cal-B"):
            fim_bloco = mais_novo(block)
            if fim_bloco is not None and not inicio_test > fim_bloco:
                problemas.append(
                    f"temporal: earliest(test)={inicio_test} nao e estritamente maior que "
                    f"latest({block})={fim_bloco}"
                )

    meio = ("dev", "cal-A", "cal-B")
    for i in range(1, len(meio)):
        anterior, atual = meio[i - 1], meio[i]
        fim_anterior, inicio_atual = mais_novo(anterior), mais_antigo(atual)
        if fim_anterior is None or inicio_atual is None:
            continue
        if not inicio_atual > fim_anterior:
            problemas.append(
                f"temporal: earliest({atual})={inicio_atual} nao e estritamente maior que "
                f"latest({anterior})={fim_anterior}"
            )

    if held_out:
        for rec in records:
            block = blocks.get(rec["id"])
            if block is None or block == "test":
                continue
            familia = group_axes.identity_of(
                (rec.get("groups") or {}).get("generatorFamily")
            )
            if familia in held_out:
                problemas.append(
                    f"reserva: {rec['id']} e da familia reservada {familia} e realiza em "
                    f"{block} em vez de test"
                )

    autoridade = declared_group_axes() if declared is None else declared
    for rec in records:
        if rec["id"] not in blocks:
            continue
        source_id = (rec.get("provenance") or {}).get("sourceId")
        # Uma linha HUMANA que NOMEIA uma fonte fora da autoridade nao tem eixo algum
        # conferido: `get(..., ())` salta o laco inteiro em silencio, entao tirar uma
        # fonte do inventario DESLIGA a checagem de lacuna para as linhas dela em vez de
        # recusa-las. O lado espelhado (corpus-source-audit.ts) recusa; o espelho passaria
        # a aceitar mais que o espelhado. Duas exclusoes, ambas deliberadas: linha gerada
        # (fonte gerada nao tem registro humano e nao declara eixo nenhum por desenho) e
        # linha sem `provenance.sourceId` (nao nomear fonte e outro defeito, e o schema
        # fechado o recusa antes — o corpo estampado dos fixtures do lab e mais frouxo).
        if (
            rec.get("label") == "human"
            and source_id is not None
            and str(source_id) not in autoridade
        ):
            problemas.append(
                f"fonte nao inventariada: {rec['id']} e humana e vem de {source_id}, "
                "que nao esta em V3_HUMAN_SOURCE_INVENTORY — nenhum eixo declarado dela "
                "pode ser conferido"
            )
            continue
        for axis in autoridade.get(str(source_id), ()):  # type: ignore[arg-type]
            # `declared_state_of` e nao `state_of`: a autoridade e parseada do
            # source-manifest.ts, que declara `sourceMaterialBatch` para toda fonte
            # humana, e `state_of` le chave AUSENTE como unknown. Ler elegibilidade aqui
            # recusaria todo corpo v3 por um eixo que a versao dele nao tem — e a
            # auditoria TS, que esta guarda espelha, aceita esse corpo.
            estado = group_axes.declared_state_of(rec, axis)
            if estado == group_axes.UNKNOWN:
                problemas.append(
                    f"eixo declarado: {rec['id']} vem de {source_id}, que declara "
                    f"\"{axis}\" aplicavel, e a linha o deixa unknown"
                )

    if not problemas:
        return

    atravessando = sum(
        1
        for raiz, blocos in _blocos_por_componente(records).items()
        if len(blocos) > 1
    )
    mostra = "; ".join(problemas[:6])
    resto = "" if len(problemas) <= 6 else f" (+{len(problemas) - 6} mais)"
    raise UnsplittableCorpus(
        f"o corpus estampado nao e splitavel: {mostra}{resto}. "
        f"{atravessando} componente(s) conectado(s) atravessam blocos e por isso caem em "
        "train, que e o fallback do splitter."
    )


def _blocos_por_componente(records: list[dict]) -> dict[str, set[str]]:
    roots = connected_components(records)
    por_raiz: dict[str, set[str]] = {}
    for rec in records:
        block = PARTITION_OF.get(rec["id"])
        if block is not None:
            por_raiz.setdefault(roots[rec["id"]], set()).add(block)
    return por_raiz


def assert_no_stamped_component_straddles(records: list[dict]) -> None:
    """CRITERIO DO CARIMBO: o componente conexo INTEIRO numa unica particao.

    A condicao, literalmente: para todo registro carimbado,
    `realized_blocks(records)[id] == PARTITION_OF[id]`. `realized_blocks` da UM bloco por
    componente — `train`, o fallback do splitter, quando o componente atravessa —, entao um
    componente com dois carimbos tem pelo menos um registro em que os dois lados diferem, e
    a igualdade sobre todos os registros e exatamente "nenhum componente atravessa bloco".

    O criterio NAO e "irmas contiguas na lista de entrada": contiguidade e uma condicao de
    ORDENACAO deduzida do criterio, e ela e INSUFICIENTE por aritmetica. Num corpo em que todo
    componente tem duas linhas e o tamanho de `train` e impar, qualquer fatiamento por posicao
    corta um componente, seja qual for a ordem da lista — e e esse corpo que
    `test_a_corpus_where_a_positional_stamp_MUST_cut_a_component` roda.
    """
    realizados = realized_blocks(records)
    if not realizados:
        return
    raizes = connected_components(records)
    for rec in records:
        carimbado = PARTITION_OF.get(rec["id"])
        if carimbado is None or realizados[rec["id"]] == carimbado:
            continue
        raiz = raizes[rec["id"]]
        blocos = sorted(_blocos_por_componente(records)[raiz])
        raise UnsplittableCorpus(
            f"o componente conexo {raiz!r} foi carimbado em mais de um bloco "
            f"({', '.join(blocos)}): {rec['id']} leva {carimbado} e o splitter poe o "
            f"componente inteiro em {realizados[rec['id']]}. O criterio e o componente "
            "conexo INTEIRO numa unica particao"
        )


def _plano_de_blocos(records: list[dict], held_out: set[str]) -> dict[str, str]:
    """record id -> bloco, com o componente conexo INTEIRO num bloco so.

    O ALVO de cada (bloco, classe) e o mesmo de sempre: quatro blocos arredondados e `test`
    como o resto, a aritmetica que `assert_the_blind_block_holds_both_roles` roda em main().
    O que limita a colocacao, porem, e o TETO da tolerancia e nao o alvo: os componentes sao
    indivisiveis, entao um corpo de componentes pares nao realiza um alvo impar, e exigir o
    alvo exato recusaria corpo que o splitter aceita — 46/4/10/20/20 em cem linhas esta a um
    ponto de 45/5/10/20/20 e dentro dos dois pontos do contrato. O piso nao e conferido aqui:
    a fracao por classe tem UMA autoridade, `assert_stamped_corpus_is_splittable`.

    As contas sao POR CLASSE, porque e por classe que o splitter compara fracao, e um
    componente e colocado somente quando cabe em TODA classe que ele carrega — um componente
    que mistura humano e gerado consome dos dois tetos do mesmo bloco.

    A ordem de consideracao e o TAMANHO decrescente, com desempate pela raiz, e nao a ordem
    da lista de entrada: componente grosso e o restritivo, e uma ordem lida da lista faria o
    plano — logo as fracoes realizadas — depender de como os pools foram concatenados. Entre
    os blocos que cabem, ganha o de maior DEFICIT contra o alvo, com empate pela ordem
    temporal: e o que puxa cada bloco para o alvo em vez de encher o primeiro que couber.

    Colocar todos os componentes nas cinco particoes e soma de subconjuntos, e o passeio
    guloso daqui nao a decide: um componente que nao cabe em bloco algum e recusado, com o
    teto e o colocado de cada bloco na mensagem. Passar por
    `assert_components_can_fill_five_partitions` e necessario e nao suficiente, e esta e
    exatamente a recusa que o preflight declara nao decidir.
    """
    raizes = connected_components(records)
    ordem: list[str] = []
    membros: dict[str, list[dict]] = {}
    for rec in records:
        raiz = raizes[rec["id"]]
        if raiz not in membros:
            membros[raiz] = []
            ordem.append(raiz)
        membros[raiz].append(rec)

    total_por_classe = Counter(rec["label"] for rec in records)
    alvo: dict[str, dict[str, int]] = {
        bloco: {
            classe: round(n * CLASS_FRACTIONS[bloco])
            for classe, n in total_por_classe.items()
        }
        for bloco in CLASS_FRACTIONS
    }
    alvo["test"] = {
        classe: n - sum(alvo[bloco][classe] for bloco in CLASS_FRACTIONS)
        for classe, n in total_por_classe.items()
    }
    # O teto da tolerancia, com o MESMO épsilon de `within_class_tolerance`: a borda é
    # inclusiva, e comparar float cru recusaria a fracao que o contrato admite.
    teto: dict[str, dict[str, int]] = {
        bloco: {
            classe: int(
                n * (BLOCK_FRACTIONS[bloco] + CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON)
            )
            for classe, n in total_por_classe.items()
        }
        for bloco in BLOCK_FRACTIONS
    }
    colocado: dict[str, dict[str, int]] = {
        bloco: dict.fromkeys(total_por_classe, 0) for bloco in BLOCK_FRACTIONS
    }
    linhas_por_classe = {
        raiz: Counter(rec["label"] for rec in membros[raiz]) for raiz in ordem
    }

    plano: dict[str, str] = {}

    def coloca(raiz: str, bloco: str) -> None:
        for classe, n in linhas_por_classe[raiz].items():
            colocado[bloco][classe] += n
        for rec in membros[raiz]:
            plano[rec["id"]] = bloco

    # A reserva primeiro, e pelo COMPONENTE: uma familia reservada realiza em `test` por
    # decisao do splitter, e o componente dela nao pode ficar metade fora. Basta UMA linha
    # reservada para o componente inteiro ser assentado, e nao todas: a linhagem junta linha
    # reservada com linha de nucleo no mesmo componente, e exigir a familia reservada em toda
    # linha mandaria esse componente ao passeio guloso — `assert_stamped_corpus_is_splittable`
    # recusaria o corpo em vez de o montar.
    reservados = [
        raiz
        for raiz in ordem
        if any(
            group_axes.identity_of((rec.get("groups") or {}).get("generatorFamily"))
            in held_out
            for rec in membros[raiz]
        )
    ]
    for raiz in reservados:
        coloca(raiz, "test")
    for classe, assentadas in colocado["test"].items():
        if assentadas > alvo["test"][classe]:
            # NAO e a mesma aritmetica que `assert_the_blind_block_holds_both_roles` roda em
            # main(), e por isso esta recusa E ALCANCAVEL de lá. Aquela compara
            # `reserved_rows_per_class`, que conta LINHAS cuja `generatorFamily` esta na
            # reserva; esta compara o FECHO dos componentes reservados, que arrasta tambem as
            # linhas nao reservadas ligadas a elas por linhagem. Fecho >= linhas, entao um
            # corpo aprovado la chega aqui e pode transbordar — e e por isso que a mensagem
            # abaixo fala de linhas ASSENTADAS e nao de linhas reservadas.
            raise ReserveFillsTheBlindBlock(
                f"the class {classe!r} seats {assentadas} line(s) in `test` and its test "
                f"block holds {alvo['test'][classe]}: every reserved COMPONENT is seated "
                "whole, so what has to fit is the closure and not the reserved lines alone. "
                "Generate fewer reserved lines, or fewer lines joined to them by lineage"
            )

    ordem_do_bloco = {bloco: i for i, bloco in enumerate(BLOCK_FRACTIONS)}
    pendentes = sorted(
        (raiz for raiz in ordem if raiz not in set(reservados)),
        key=lambda raiz: (-sum(linhas_por_classe[raiz].values()), raiz),
    )
    for raiz in pendentes:
        cabem = [
            bloco
            for bloco in ordem_do_bloco
            if all(
                colocado[bloco][classe] + n <= teto[bloco][classe]
                for classe, n in linhas_por_classe[raiz].items()
            )
        ]
        if not cabem:
            raise UnsplittableCorpus(
                f"o componente conexo {raiz!r} tem {dict(linhas_por_classe[raiz])} e nao "
                f"cabe inteiro em bloco algum sem passar do teto da tolerancia: colocado "
                f"{colocado} contra teto {teto}. Atribuir os componentes as cinco "
                "particoes e soma de subconjuntos, e a geometria do preflight nao a decide"
            )
        coloca(
            raiz,
            max(
                cabem,
                key=lambda bloco: (
                    min(
                        alvo[bloco][classe] - colocado[bloco][classe]
                        for classe in linhas_por_classe[raiz]
                    ),
                    -ordem_do_bloco[bloco],
                ),
            ),
        )
    return plano


def _island_component(ilha: dict) -> list[dict]:
    """As linhas de UMA ilha, com os eixos que decidem conectividade e nada mais.

    Sinteticas por decisao: o que a perna de geometria julga e se COMPONENTES daquele
    tamanho realizam as cinco fracoes, e um componente e um numero de linhas por classe.
    Construir texto, licenca e proveniencia mediria o validador.

    As tres classes ficam num componente SO, e as ARESTAS que o fecham sao estas — nao o
    `author`, que e proprio de cada humana (medido: 200 identidades em 200 linhas humanas):

      * cada gerada nomeia UMA humana em `humanSeed` (linhagem de pai), e a cobertura de
        toda humana depende de `lines["ai"] == lines["human"]`, porque o indice e tomado
        modulo o numero de humanas. Com menos geradas que humanas as humanas nao nomeadas
        ficam SOZINHAS: medido, 100 geradas sobre 200 humanas dao 101 componentes;
      * as geradas agrupam-se por `promptTemplate`, entao dois templates sao DOIS grupos, e
        a ponte entre eles sao as mistas, que nomeiam uma humana em `derivationRoot` — uniao
        POR VALOR. Sem linha mista a ilha mede 2 componentes, um por template — medido —, e
        com uma mista so ainda mede 2, porque uma mista alcanca a humana de um grupo apenas.

    As mistas partilham `promptTemplate` DENTRO do cluster de operacao, nao ao longo da
    ilha: sao tres clusters, um por template de mistura. O CRITERIO que fecha a ilha em um
    componente e **ao menos um** cluster alcancar as duas metades de template de geracao;
    construir todos alcancando e condicao SUFICIENTE deduzida dele, e a distincao e medida
    (as fixtures que a prendem estao em `test_connectivity_feasibility.py`): tres clusters
    cobrindo as duas metades SOMADOS mas nenhum individualmente racham a ilha em 2, e um
    cluster livre com os outros dois presos a uma paridade fecha em 1. A paridade importa
    porque as linhas `ai` alternam template pelo indice do pai.

    Dar pai de outra ilha a uma linha mista funde as duas — medido, 2 componentes viram 1 —
    e e essa a razao de (iii).
    """
    # Os ids e as identidades levam o prefixo `plano_`, e nao e cosmetica: estas linhas nao
    # sao registros do corpus e nao podem ser confundidas com eles. O sweep
    # `test_no_module_mints_a_per_record_group_token` proibe neste modulo as cinco grafias com
    # que o bloco fabricado de v2 cunhava identidade POR REGISTRO, e a proibicao vale — o que
    # se constroi aqui e a GEOMETRIA de um plano, nao linha de material.
    nome = ilha["island"]
    humanas = [f"plano_h_{nome}_{i:04d}" for i in range(ilha["lines"]["human"])]
    if not humanas:
        raise IslandPlanRefused(
            f"a ilha {nome!r} declara zero linha humana: sem bloco de material humano nao "
            "ha ilha, porque e o bloco que particiona os tres eixos"
        )
    registros: list[dict] = []
    for rid in humanas:
        registros.append(
            {
                "id": rid,
                "schemaVersion": 4,
                "label": "human",
                "groups": {
                    "author": group_axes.known(f"plano_au_{rid}"),
                    "source": group_axes.known(f"plano_th_{rid}"),
                    "promptTemplate": group_axes.not_applicable("linha humana"),
                    "generationBatch": group_axes.not_applicable(
                        group_axes.NOT_A_GENERATED_ROW
                    ),
                    "nearDuplicate": group_axes.known(f"plano_dup_{rid}"),
                    "derivationRoot": group_axes.not_applicable("texto extraido"),
                },
            }
        )
    templates = tuple(ilha["templates"]) or (nome,)
    for i in range(ilha["lines"]["ai"]):
        rid = f"plano_a_{nome}_{i:04d}"
        registros.append(
            {
                "id": rid,
                "schemaVersion": 4,
                "label": "ai",
                "groups": {
                    "author": group_axes.not_applicable(group_axes.NO_HUMAN_AUTHOR),
                    "source": group_axes.not_applicable("texto gerado"),
                    "humanSeed": group_axes.known(humanas[i % len(humanas)]),
                    "promptTemplate": group_axes.known(templates[i % len(templates)]),
                    "generationBatch": group_axes.known(f"plano_gb_{rid}"),
                    "nearDuplicate": group_axes.known(f"plano_dup_{rid}"),
                    "derivationRoot": group_axes.not_applicable(
                        group_axes.NO_DERIVATION
                    ),
                },
            }
        )
    # A operacao da linha `i` sai da MESMA `mix_cell_allocation` que o laco de
    # `make_mixed.py` le, e nao de uma segunda expansao: o que a geometria modela por indice
    # e o que a pista estampa por indice, ou o plano valida um corpo que ninguem escreve. O
    # pai da mista `i` continua sendo `humanas[i % len(humanas)]` — pai da MESMA ilha, um
    # nivel por pai —, e os blocos contiguos da alocacao dao as duas paridades a todo
    # cluster, com margem sobre o criterio de "ao menos um".
    mistas = ilha["lines"]["mixed"]
    operacao_de = [operacao for operacao, _nivel in mix_cell_allocation(mistas)]
    for i in range(mistas):
        rid = f"plano_m_{nome}_{i:04d}"
        registros.append(
            {
                "id": rid,
                "schemaVersion": 4,
                "label": "mixed",
                "groups": {
                    "author": group_axes.unknown("coautoria"),
                    "source": group_axes.known(f"plano_th_{rid}"),
                    "humanSeed": group_axes.known(humanas[i % len(humanas)]),
                    "promptTemplate": group_axes.known(
                        ilha["mixingTemplates"][operacao_de[i]]
                    ),
                    "generationBatch": group_axes.known(f"plano_gb_{rid}"),
                    "nearDuplicate": group_axes.known(f"plano_dup_{rid}"),
                    "derivationRoot": group_axes.known(humanas[i % len(humanas)]),
                },
            }
        )
    return registros


def assert_island_plan_is_a_partition(plan: tuple[dict, ...]) -> None:
    """O plano PARTICIONA os eixos de REGISTRO: cada valor numa ilha so, e todo bucket coberto.

    Disjuncao E cobertura, porque particao e as duas. A disjuncao percorre TODOS os valores
    de TODAS as ilhas — um passeio com saida antecipada aprovaria um plano cuja primeira
    ilha e limpa e cuja ultima reusa um template. A cobertura e sobre `seedBlock`: se os
    blocos declarados nao sao exactamente os buckets que `island_of_seed` pode produzir, ha
    candidato humano que nao pertence a ilha alguma, e a linha gerada dele nao tem ilha.

    O eixo e o de REGISTRO e nao o campo do plano, e a diferenca morde: `templates` e
    `mixingTemplates` sao campos distintos do plano que escrevem o MESMO eixo
    `groups.promptTemplate` — o de geracao nas linhas `ai`, o de mistura nas mistas. Um
    namespace por campo aprovaria um plano cujo `mixingTemplates` traz o `templates` de outra
    ilha, e o corpo colapsaria com as pernas todas verdes; medido, 19 componentes onde o plano
    declara 20. Por isso os dois campos partilham UM namespace, e o dono nomeia o campo de
    onde o valor veio, para a mensagem continuar diagnostica.

    As pernas e a cobertura sao independentes, e cada uma tem fixture que colide aquela perna
    e so aquela — sem isso a perna pode sair do laco e a suite fica verde. Note que uma
    colisao de `seedBlock` tambem quebra a cobertura: e a MENSAGEM que separa as duas, e e por
    ela que as fixtures afirmam.
    """
    if not plan:
        raise IslandPlanRefused(
            "plano vazio: sem ilha declarada nao ha o que recusar nem o que gerar"
        )
    # O VOCABULARIO antes do passeio, porque a disjuncao so significa algo se as chaves
    # forem as operacoes: chave a mais nao tem celula no plano, chave a menos deixa a ilha
    # sem cluster para aquela operacao, e uma grafia acentuada contrabandearia duas
    # identidades da mesma operacao sob nomes diferentes.
    #
    # A FORMA vem antes das chaves, e nao e zelo: o passeio de disjuncao adiante chama
    # `.items()`, entao um `mixingTemplates` que nao e mapa morre la num `AttributeError` —
    # e uma tupla com os tres NOMES DE OPERACAO chega intacta a esta conferencia. E a
    # comparacao e de CONJUNTOS com a ordenacao guardada para a mensagem (`key=repr`):
    # `sorted()` sobre chave que nao e str levanta `TypeError`, e o chamador desta funcao
    # captura `IslandPlanRefused` e mais nada, entao qualquer uma das duas excecoes troca a
    # recusa com razao por um traceback.
    operacoes = set(MIX_OPERATIONS)
    for ilha in plan:
        bruto = ilha["mixingTemplates"]
        if not isinstance(bruto, Mapping):
            raise IslandPlanRefused(
                f"a ilha {ilha['island']!r} declara `mixingTemplates` que nao e mapa e sim "
                f"{type(bruto).__name__}: sem chave por operacao nao ha o que conferir, e um "
                "plano assim atravessa a conferencia de chaves quando os elementos SAO os "
                "nomes das operacoes"
            )
        declaradas = set(bruto)
        if declaradas != operacoes:
            raise IslandPlanRefused(
                f"a ilha {ilha['island']!r} declara chaves de mistura que nao sao as "
                f"operacoes: sobrando {sorted(declaradas - operacoes, key=repr)}, faltando "
                f"{sorted(operacoes - declaradas, key=repr)} (declaradas "
                f"{sorted(declaradas, key=repr)}; operacoes {sorted(operacoes, key=repr)}). "
                "Sem uma chave por operacao a ilha carrega menos operacoes do que a curva "
                "compra, ou compra celula que o plano nao declara — e as duas so aparecem na "
                "montagem, depois de a cota estar gasta"
            )
    # Um eixo de REGISTRO por entrada, e os campos do plano que o escrevem. `promptTemplate`
    # recebe DOIS campos, porque as linhas `ai` e as mistas escrevem o mesmo eixo.
    eixos: tuple[tuple[str, tuple[str, ...]], ...] = (
        (
            "promptTemplate (template de geracao e de mistura)",
            ("templates", "mixingTemplates"),
        ),
        ("seedBlock (bloco de semente humana)", ("seedBlock",)),
    )
    for rotulo, campos in eixos:
        donos: dict[object, list[str]] = {}
        for ilha in plan:
            for campo in campos:
                bruto = ilha[campo]
                # O dono nomeia a OPERACAO e nao so o campo: `ilha_19/mixingTemplates` nao
                # diz qual dos tres slots colidiu, e a mensagem deixa de ser diagnostica.
                if campo == "mixingTemplates":
                    pares = tuple(
                        (f"{campo}[{operacao}]", valor)
                        for operacao, valor in bruto.items()
                    )
                elif campo == "templates":
                    pares = tuple((campo, valor) for valor in bruto)
                else:
                    pares = ((campo, bruto),)
                for nome, valor in pares:
                    donos.setdefault(valor, []).append(f"{ilha['island']}/{nome}")
        if not all(len(ilhas) == 1 for ilhas in donos.values()):
            colisoes = {
                valor: ilhas for valor, ilhas in donos.items() if len(ilhas) > 1
            }
            raise IslandPlanRefused(
                f"o plano nao particiona o eixo de registro {rotulo!r}: {colisoes}. Duas "
                "ilhas que partilham um valor sao UMA ilha no grafo, e o corpo colapsa "
                "depois de a cota estar gasta. O campo esta no nome de cada dono, porque "
                "`templates` e `mixingTemplates` escrevem este mesmo eixo"
            )
    blocos = sorted(ilha["seedBlock"] for ilha in plan)
    if blocos != list(range(len(plan))):
        raise IslandPlanRefused(
            f"os blocos de semente do plano sao {blocos} e `island_of_seed` produz "
            f"{list(range(len(plan)))}: ha candidato humano sem ilha, e a linha gerada "
            "dele nao pode pertencer a nenhuma"
        )


def assert_island_plan_realizes_the_five_fractions(plan: tuple[dict, ...]) -> None:
    """A GEOMETRIA do plano, julgada pelas funcoes de PRODUCAO e nao por um numero.

    Tres autoridades, e nenhuma das tres e dispensavel — medido sobre a classe ai de 4000
    linhas: 12 e 14 ilhas sao recusadas pelo preflight (o MENOR componente vale 8,33 % e
    7,14 % contra 7 %); 16 ilhas de 250 e 18 de ~222 PASSAM o preflight e `_plano_de_blocos`
    nao as atribui ("nao cabe inteiro em bloco algum"); 15 ilhas de ~266 passam as duas e
    realizam `cal-A` em 6,65 % contra um alvo de 10 %, fora da tolerancia. Uma guarda que
    comparasse "entre 15 e 20 ilhas de 200 a 270 linhas" aprovaria os tres.
    """
    por_ilha = [(ilha["island"], _island_component(ilha)) for ilha in plan]
    registros = [linha for _, linhas in por_ilha for linha in linhas]
    # UMA ilha e UM componente conexo, e este e o criterio do proprio conceito — nao uma
    # condicao deduzida dele. Sem esta perna a guarda julga as fracoes de um corpo cujas
    # ilhas podem ter-se fundido, e o colapso aparece na montagem, depois da cota. Medido:
    # tres clusters de mistura cobrindo as duas metades de template somados mas nenhum
    # individualmente dao 40 componentes onde o plano declara 20.
    #
    # E a conferencia e a BIJECAO ilha <-> componente nas DUAS direcoes, porque CONTAR
    # componentes nao e o criterio: medido, rachar `ilha_05` e `ilha_06` por paridade e
    # cruzar cada metade com a outra ilha por UM pai de mista devolve 20 componentes de 500
    # linhas com o perfil 200/200/100 de uma ilha natural — a contagem fica intacta e nenhuma
    # das duas ilhas particiona eixo algum. As direcoes sao independentes: uma ilha em mais de
    # um componente e duas ilhas no mesmo componente aparecem sozinhas (o `mixingTemplates`
    # da ultima ilha igual ao da primeira funde duas sem rachar nenhuma), entao cada uma tem
    # a sua recusa e a mensagem nomeia a que foi MEDIDA.
    raizes = connected_components(registros)
    raizes_por_ilha = [
        (nome, {raizes[linha["id"]] for linha in linhas}) for nome, linhas in por_ilha
    ]
    componentes = len(set(raizes.values()))
    rachadas = {nome: len(das) for nome, das in raizes_por_ilha if len(das) != 1}
    if rachadas:
        raise IslandPlanRefused(
            f"o plano declara {len(plan)} ilha(s) e o corpo modelado fecha em "
            f"{componentes} componente(s) conexo(s), e ha ilha que nao e UM deles: "
            f"{rachadas} (ilha -> componentes em que as linhas dela caem). Uma ilha rachada "
            "nao particiona eixo algum, e as fracoes realizadas por um corpo desses nao "
            "dizem nada sobre o plano"
        )
    donas: dict[str, list[str]] = {}
    for nome, das in raizes_por_ilha:
        donas.setdefault(next(iter(das)), []).append(nome)
    partilhadas = {raiz: nomes for raiz, nomes in donas.items() if len(nomes) > 1}
    if partilhadas:
        raise IslandPlanRefused(
            f"o plano declara {len(plan)} ilha(s) e o corpo modelado fecha em "
            f"{componentes} componente(s) conexo(s), e ha componente reclamado por mais de "
            f"uma ilha: {partilhadas} (raiz -> ilhas que a partilham). Duas ilhas no mesmo "
            "componente sao UMA ilha no grafo, e as fracoes realizadas por um corpo desses "
            "nao dizem nada sobre o plano"
        )
    try:
        assert_components_can_fill_five_partitions(registros)
        plano = _plano_de_blocos(registros, set())
    except (UnsplittableCorpus, ReserveFillsTheBlindBlock) as recusa:
        raise IslandPlanRefused(
            f"a geometria do plano ({len(plan)} ilha(s), "
            f"{ISLAND_PLAN_CLASS_LINES}) nao realiza as cinco particoes: {recusa}"
        ) from None
    total = Counter(rec["label"] for rec in registros)
    realizado: Counter = Counter()
    for rec in registros:
        realizado[(plano[rec["id"]], rec["label"])] += 1
    fora = [
        (bloco, classe, realizado[(bloco, classe)] / total[classe], alvo)
        for bloco, alvo in BLOCK_FRACTIONS.items()
        for classe in sorted(total)
        if not within_class_tolerance(realizado[(bloco, classe)] / total[classe], alvo)
    ]
    if fora:
        raise IslandPlanRefused(
            f"a geometria do plano atribui, mas as fracoes realizadas ficam fora da "
            f"tolerancia de {CLASS_TOLERANCE}: "
            + "; ".join(
                f"{bloco}/{classe} realiza {f:.4f} contra alvo {alvo}"
                for bloco, classe, f, alvo in fora
            )
        )


def assert_island_plan_leaves_core_in_the_blind_block(plan: tuple[dict, ...]) -> None:
    """A reserva deixa lugar em `test` para ao menos UMA ilha de nucleo, em toda classe.

    O CRITERIO, e nao uma contagem de ilhas deduzida dele: `_plano_de_blocos` assenta todo
    componente reservado INTEIRO em `test`, cujo alvo e o RESTO depois dos quatro blocos
    arredondados. `ReserveFillsTheBlindBlock` recusa somente acima desse alvo, entao uma
    reserva que o preenche EXACTAMENTE passa por ela e deixa o bloco cego inteiramente de
    reserva — e o bloco cego carrega DUAS hipoteses, o recall sobre familia vista e a fatia
    de gerador nao visto. Sem populacao de nucleo a segunda existe e a primeira nao.
    """
    reservadas = [ilha for ilha in plan if ilha["reserved"]]
    nucleo = [ilha for ilha in plan if not ilha["reserved"]]
    if not nucleo:
        raise IslandPlanRefused(
            "o plano reserva TODAS as ilhas: o bloco cego nao teria linha de nucleo, e o "
            "recall sobre familia vista nao tem populacao"
        )
    for classe, total in ISLAND_PLAN_CLASS_LINES.items():
        alvo_test = total - sum(
            round(total * CLASS_FRACTIONS[bloco]) for bloco in CLASS_FRACTIONS
        )
        assentado = sum(ilha["lines"][classe] for ilha in reservadas)
        menor_nucleo = min(ilha["lines"][classe] for ilha in nucleo)
        if assentado + menor_nucleo > alvo_test:
            raise IslandPlanRefused(
                f"a reserva assenta {assentado} linha(s) de {classe!r} em `test`, cujo "
                f"alvo e {alvo_test}, e a menor ilha de nucleo tem {menor_nucleo}: nao "
                "sobra lugar para uma ilha de nucleo no bloco cego"
            )


def island_of_seed(plan: tuple[dict, ...], candidate_id: str) -> dict:
    """A ilha a que uma semente humana pertence, por bucket determinista do id.

    O bloco de sementes e DERIVADO e nao enumerado: 4000 ids nao cabem numa constante, e um
    plano que os enumerasse envelheceria a cada re-extracao. O bucket e funcao do id
    sozinho, entao duas ilhas nunca partilham uma semente — que e a condicao sem a qual o
    particionamento de templates e decorativo: medido nos pools em HEAD, 116 de 1046
    sementes sao emparelhadas por linhas de MAIS DE UMA corrida de versao, e so essas
    arestas fundem as cinco corridas numa ilha.
    """
    digest = hashlib.sha256(f"island-seed:{candidate_id}".encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:8], "big") % len(plan)
    for ilha in plan:
        if ilha["seedBlock"] == bucket:
            return ilha
    raise IslandPlanRefused(
        f"o plano nao declara bloco de semente {bucket}: o candidato {candidate_id!r} "
        "nao pertence a ilha alguma"
    )


def island_named(plan: tuple[dict, ...], name: str) -> dict:
    """A ilha que o nome nomeia, ou uma recusa que lista as admissiveis."""
    for ilha in plan:
        if ilha["island"] == name:
            return ilha
    raise IslandPlanRefused(
        f"ilha {name!r} nao esta no plano. Ilhas declaradas: "
        + ", ".join(ilha["island"] for ilha in plan)
    )


def assign_partitions(records: list[dict], held_out: set[str]) -> None:
    """Exact 45/5/10/20/20 blocks per class, with held-out families INSIDE the test
    block rather than on top of it.

    The split imposes two constraints at once: a held-out component whose time
    reaches any earlier partition is refused outright, AND the realized class
    fractions must land within classTolerance (0.02) of 45/5/10/20/20. Forcing
    held-out records into test on top of an independent split of the remainder
    satisfies the first and breaks the second — held-out families reach the mixed
    class too (a mixing model is a generator), so 714 held-out mixed records would
    have pushed mixed's test share far past its 20% target and the split would have
    refused the corpus. So size the test block first, seat the held-out records in
    it, and top it up from the rest.

    `test` is sized as the REMAINDER after the four rounded blocks, so the five always
    sum to the class size exactly. That also means test absorbs the rounding error of
    the other four — at 20% with a two-point tolerance there is room for it, and at
    dev's 5% there would not have been.

    The blocks are filled by CONNECTED COMPONENT and never by position in the list. A
    walk that slices the list produces a corpus its own guard below refuses: a component
    whose lines fall on both sides of a cursor boundary lands half in one block and half
    in another, `realized_blocks` collapses it to `train`, and the class fraction and the
    temporal order both move. Whether the list happens to keep siblings adjacent is a
    property of how the pools were concatenated, not of this function.
    """
    # A GEOMETRIA antes do carimbo: um corpo cujos componentes não podem realizar as cinco
    # frações não fica divisível por ser estampado, e a recusa daqui nomeia granularidade — a
    # guarda do corpo estampado, abaixo, só sabe dizer "fração por classe".
    assert_components_can_fill_five_partitions(records)

    plano = _plano_de_blocos(records, held_out)
    for rec in records:
        stamp_block(rec, plano[rec["id"]])

    assert_no_stamped_component_straddles(records)
    assert_stamped_corpus_is_splittable(records, held_out)


# --- loading + selection -----------------------------------------------------


def load_humans(cand: Path = CAND, reserved: Path | None = None) -> list[dict]:
    """Fresh pools + reserved-clean humans, each tagged with its quota cell.

    TWO screens, and both are needed. The pool FILES read are the frame's own: the
    Stack Overflow, B2W and Carolina pools are not opened, so their rows never enter the
    selection and never consume the cell's quota (they are named, with the reason, in
    `A1_BLOCKED_DOMAIN_SOURCES` and `OUT_OF_FRAME_DOMAIN_SOURCES`). The `REGISTER`
    filter then catches a row of an out-of-frame stratum INSIDE a frame pool file, which
    is the real case: the reserved pool below is keyed by the OLD frame's strata, so its
    Carolina rows arrive at this loader and have to be dropped by cell rather than by
    file name.

    `cand` is a parameter so a RE-EXTRACTION can be assembled without overwriting
    the pools of the failed run: §7 of the plan puts benchmark/data/corpus-build in
    "Descarte", and reading from a fresh directory is how C2 proves the identity
    comes out right end to end without destroying the evidence of the diagnosis."""
    rows: list[dict] = []
    for fname in ("wikipedia_fresh",):
        for r in read_jsonl(cand / f"{fname}.jsonl"):
            if r["domainSource"] in REGISTER:
                # NOTHING is stamped here, and the absence is the point. This loader knows
                # which FILE it opened, and a file is not an execution: `CandidateWriter`
                # takes `append=True`/`start_sequence`, so one pool file can hold the lines
                # of more than one run. Both batch axes — the acquisition event and the
                # execution that read it — come from the extractor that opened the
                # material, and `human_record` refuses a line carrying neither, counted.
                rows.append(r)
    # reserved-clean humans (never trained, not mixed parents) reuse the same
    # candidate shape; their family field is the domainSource.
    #
    # O CAMINHO E ARGUMENTO, e a razao e medida: enquanto ele era `DATASET /
    # "reserved.jsonl"` fixo, uma corrida `--sample` sobre um `--candidates-dir` de tres
    # linhas colhia 583 humanas do disco real, porque este loader ignorava o
    # `--candidates-dir` que o resto do funil respeita. Um teste do funil tinha de desviar
    # `DATASET` por dentro para nao medir o material da maquina.
    parents = set()
    for f in ("mixed_candidates.jsonl", "mixed_from_pairs.jsonl"):
        for r in read_jsonl(cand / f):
            parents.add(r["parentId"])
    for r in read_jsonl(reserved if reserved is not None else DATASET / "reserved.jsonl"):
        if r.get("label") == 0 and r["id"] not in parents:
            fam = r.get("family", "?")
            if fam in REGISTER:
                rows.append(
                    {
                        "candidateId": r["id"],
                        "text": r["text"],
                        "wordCount": len(r["text"].split()),
                        "domainSource": fam,
                        # EMPTY, and every gap in it is a fact about these rows: they
                        # predate the extractors that emit identity, so their author/source
                        # axes are `unknown`, they carry no date evidence, and they name no
                        # acquisition event, no extraction run and no document licence.
                        # `human_record` refuses them (MissingDocumentLicense is the first
                        # of the four to fire) and main() counts them — a v2 corpus could
                        # take them and a sealed one cannot, which is a real cost of the
                        # reserved pool and not something to fill in by hand. Naming a run
                        # for them here would be a name for an execution that never ran.
                        "meta": {},
                    }
                )
    return rows


def load_ai(cand: Path = CAND) -> list[dict]:
    rows: list[dict] = []
    # ORDER IS THE SELECTION PRIORITY: the pool is truncated at the class quota
    # from the end, so the least reproducible generations come first. The
    # gemini-3.x lanes carry the held-out families, and two of those models have
    # since left the provider's roster — those records can never be regenerated.
    # ai_reserved (madras + luna) is the replaceable bulk, so it absorbs the cut.
    #
    # The OOD reserve is FIRST, and the position is the whole of its protection: a
    # reserved family seats whole in the blind block or its lines leave the corpus, so
    # a reserved row cut by the class quota is not a smaller reserve, it is a reserve
    # the assembly then refuses (`HeldOutReserveEmpty`, or a family under
    # `HELD_OUT_MINIMUM`). It is also the only material whose harness version was
    # captured, which is what the reserve's positives floor is filtered by.
    for fname in (
        "ai_reserved_qwen",
        "ai_fresh_agy",
        "ai_fresh_agy_low",
        "ai_fresh_gemini",
        "ai_fresh_gemini_multi",
        "ai_fresh_codex",
        "ai_fresh_codex_topup",
        "ai_reserved",
    ):
        for r in read_jsonl(cand / f"{fname}.jsonl"):
            # reserved rows lack candidateId/meta; normalize the shape.
            if "candidateId" not in r:
                r = {
                    "candidateId": r["id"],
                    "text": r["text"],
                    "wordCount": r.get("wordCount", len(r["text"].split())),
                    "meta": {"family": r.get("family", "unknown")},
                }
            rows.append(r)
    return rows


def load_mixed(cand: Path = CAND) -> list[dict]:
    rows: list[dict] = []
    for f in ("mixed_candidates.jsonl", "mixed_from_pairs.jsonl"):
        for r in read_jsonl(cand / f):
            rows.append(r)
    return rows


def assign_generation_batches(records: list[dict]) -> list[dict]:
    """Group generated records into declared generation batches, in place.

    The governance audit refuses every controlled-generation record whose
    groups.generationBatch does not name a batch in the reviewed source manifest
    whose declared recipe matches the record's generation block EXACTLY —
    sourceId, provider, family, model, version, prompt digest, temperature,
    generatedAt and seed. So batches are derived FROM the records: one per
    distinct recipe, which makes the match hold by construction.

    This is why the axis cannot be unique per record, as it was: a per-record token
    names no declared batch, and all 5726 generated records of the dead corpus were
    blocked with GENERATION_RECIPE_MISSING. Sharing it is safe for the split even
    though generationBatch is a grouping axis — generatedAt is part of the batch key
    and equals the record's temporal block, so a batch is an indivisible component
    that can never straddle two blocks.

    Human records are untouched here, and no longer by convention: the axis rule admits
    only `notApplicable` for `generationBatch` on a human row, so a human record cannot
    name a declared generation batch at all. Its own two batch axes —
    `sourceMaterialBatch` and `extractionRun` — are assigned by its builder.
    """
    batches: dict[tuple, dict] = {}
    for rec in records:
        generation = rec.get("generation")
        if rec["provenance"]["sourceKind"] != "controlled-generation":
            continue
        if not generation:
            continue
        key = (
            rec["provenance"]["sourceId"],
            generation["provider"],
            generation["family"],
            generation["model"],
            generation["version"],
            generation["promptTemplateDigest"],
            # The DECODING and the EFFORT, canonicalised, are part of the batch key
            # now. In v2 the key carried a bare `temperature`, which could not tell a
            # CLI lane (no sampling knob at all) from an api lane that happened to
            # leave the default in place — so two recipes that differ in what the
            # provider was allowed to do collapsed into one declared batch.
            json.dumps(generation["decoding"], sort_keys=True),
            json.dumps(generation["effort"], sort_keys=True),
            generation["generatedAt"],
            generation.get("seed"),
        )
        batch = batches.get(key)
        if batch is None:
            batch = {
                "batchId": f"gb_{rec['label']}_{len(batches):04d}",
                "sourceId": key[0],
                "generationProtocolVersion": "generation-v1",
                "provider": generation["provider"],
                "family": generation["family"],
                "model": generation["model"],
                "version": generation["version"],
                "promptTemplateDigest": generation["promptTemplateDigest"],
                # Exactly one of temperature / temperatureNullReason, the pair C1
                # closed. This is the arm C1's own comment said "the v3
                # repropagation (C2) is what will emit": on a lane whose frozen row
                # sets `decodingConfigurable: false` there is no temperature to
                # declare, and the batch now SAYS SO instead of publishing the 0.8
                # that generate_ai.py wrote into every provider's meta while
                # invoking three of them with no sampling flag.
                "temperature": recipe_temperature(generation),
                "temperatureNullReason": (
                    None
                    if recipe_temperature(generation) is not None
                    else TEMPERATURE_NULL_REASON
                ),
                "generatedAt": generation["generatedAt"],
                # Exactly one of seed / seedNullReason, per the manifest parser.
                "seed": generation.get("seed"),
                "seedNullReason": (
                    None if generation.get("seed") else SEED_NULL_REASON
                ),
            }
            batches[key] = batch
        # Sharing it across a batch is safe for the split even though generationBatch IS
        # a grouping axis: generatedAt is part of the batch key and equals the record's
        # temporal block, so a batch is an indivisible component that can never straddle
        # two blocks.
        rec["groups"]["generationBatch"] = group_axes.known(batch["batchId"])
    return list(batches.values())


def recipe_temperature(generation: dict) -> float | None:
    """The temperature the recipe APPLIED, or None when none did.

    The Python mirror of `recipeTemperature` in benchmark/schema.ts, and it exists
    for the same reason: a consumer comparing a record against a declared batch is
    asking one question, and the answer lives in a different place depending on
    whether the lane could be configured at all.
    """
    decoding = generation.get("decoding") or {}
    if not decoding.get("configurable"):
        return None
    return decoding.get("temperature")


# --- identidade e referencia, e a distincao e o desenho ---------------------------
#
# `parentId` e chave ESTRANGEIRA: e o nome com que a linha mista aponta para o pai
# humano. `candidateId` e IDENTIDADE. Sao papeis diferentes, e o custo de os confundir
# foi medido em tres sitios: a uniao do split e saltada em silencio quando o valor
# apontado deixa de ser id de registro presente; `near_dupes.prune` devolve NOMES, entao
# duas linhas com o mesmo nome vivem e morrem juntas mesmo em clusters diferentes; e quem
# e renomeado passa a depender da ORDEM dos pools.
#
# A regra deste bloco: a identidade da linha no funil e a identidade do REGISTRO que ela
# vai produzir, e so ela e desambiguavel.

MIXED_ID_PREFIX = "mix_"
FUNNEL_KEY_FIELD = "_funnelKey"
PARENT_IDENTITY_FIELD = "_parentIdentity"


class ParentIdentityAmbiguous(RuntimeError):
    """A referencia de uma mista resolve em MAIS DE UMA linha humana do pool."""


def mixed_own_key(row: dict) -> str:
    """A identidade da linha mista: o id do registro que ela produz, `mix_<pai>`.

    Derivada do pai e ainda assim identidade, e a distincao nao e verbal: o valor NOMEIA
    esta linha, entao e este que a desambiguacao pode mover. `mixed_record` le a mesma
    funcao para escrever `id`, de modo que funil e registro nao tem duas grafias da
    mesma identidade.
    """
    return f"{MIXED_ID_PREFIX}{slug(row['parentId'])}"


def funnel_key(row: dict) -> str:
    """A identidade desta linha no funil, que E o id do registro que ela vai produzir.

    Uma funcao e nao uma lambda porque a triagem, a poda, a desambiguacao e os
    construtores tem de concordar sobre o que e "a identidade desta linha". O campo
    carimbado vem primeiro porque a desambiguacao escreve nele — e escreve NELE e nao no
    `candidateId` da linha, para que nenhuma referencia guardada por outra linha se mova.

    O `slug` E DAQUI, e o cross-review mediu por que: os construtores escrevem
    `slug(identidade)`, entao com a unicidade imposta sobre a chave CRUA duas chaves
    distintas que o `slug` colapsa — `id.a` e `id_a` — passavam as duas e escreviam o
    MESMO `id`. Slugando na identidade, "a identidade e o id do registro" deixa de ser
    aproximacao e passa a ser igualdade de cadeia, e a desambiguacao opera no espaco em
    que a colisao existe. `slug` e idempotente, entao a chave ja desambiguada nao se
    move ao voltar por aqui.
    """
    stamped = row.get(FUNNEL_KEY_FIELD)
    if stamped:
        # O CARIMBO TAMBEM PASSA PELO SLUG. Escrito por `enforce_unique_keys` ele ja e
        # token — chave slugada mais sufixo hexadecimal —, mas devolve-lo cru fazia da
        # normalizacao uma propriedade de quem escreve em vez de uma propriedade desta
        # funcao, e um carimbo posto a mao entrava sem passar por ela.
        return slug(stamped)
    candidate_id = row.get("candidateId")
    if candidate_id:
        return slug(candidate_id)
    # A LINHA GERADA DA RESERVA nomeia-se por `id` e nao por `candidateId`, e este ramo
    # existe para que a identidade venha de UMA funcao: `ai_record` lia `cand["id"]` por
    # conta propria, e as duas fontes divergiam exactamente na linha em que
    # `candidateId` vinha vazio.
    row_id = row.get("id")
    if row_id:
        return slug(row_id)
    return mixed_own_key(row)


def parent_key(row: dict) -> str:
    """A chave do pai que esta linha mista nomeia. REFERENCIA, nunca identidade.

    Nomeada para poder ser lida como o que e: nada no funil a reescreve, entao ela casa
    com o `candidateId` do pai em qualquer ponto do caminho — antes ou depois da
    desambiguacao.
    """
    return row["parentId"]


def enforce_unique_keys(pools: list[list[dict]]) -> dict[str, str]:
    """Make each row's IDENTITY unique across ALL pools, in place.

    A candidate id is derived from (provider, parent), so two generation lanes
    asked for the same parent produce DIFFERENT texts under the SAME id —
    sibling lanes only dedupe against their own output file, and two lanes
    appending to one file dedupe against whatever it held when each started.

    The sealed ingest is fail-closed on DUPLICATE_ID, and colliding ids would
    also collapse the per-record group tokens that keep split components
    singleton, so the clash is resolved here rather than costing a full ingest
    run to discover. The suffix is a digest of the record's own text: stable
    across runs, and it keeps both texts instead of discarding hard-won
    generations that are only accidentally named alike.

    NAO RECEBE NOME DE CAMPO, e a ausencia do parametro e o mecanismo: com um nome de
    campo era possivel — e foi feito — apontar esta funcao a `parentId`, que e uma
    referencia. A identidade sai de `funnel_key` e o valor desambiguado entra em
    `FUNNEL_KEY_FIELD`, entao nenhum campo que outra linha cita e tocado aqui.
    """
    seen: set[str] = set()
    renames: dict[str, str] = {}
    for rows in pools:
        for row in rows:
            key = funnel_key(row)
            if key not in seen:
                seen.add(key)
                continue
            _, digest = norm_hash(row["text"])
            candidate = f"{key}_{digest[:8]}"
            suffix = 0
            while candidate in seen:  # digest collision: still must be unique
                suffix += 1
                candidate = f"{key}_{digest[:8]}_{suffix}"
            row[FUNNEL_KEY_FIELD] = candidate
            seen.add(candidate)
            renames[key] = candidate
    return renames


def drop_orphan_derived_rows(
    humans: list[dict], ai: list[dict], mixed: list[dict]
) -> tuple[list[dict], list[dict], dict[str, int]]:
    """As linhas derivadas cujo pai NAO esta no pool humano saem, contadas por classe.

    POR QUE ANTES DA SELECAO, e nao depois da construcao. Uma linha derivada sem pai
    presente nao pode entrar no corpus — `assertDerivedParentsResolve` recusa o corpus
    inteiro por ela —, entao deixa-la chegar a selecao faz a cota ser preenchida com
    linhas que desaparecem depois: 4.000 escolhidas, menos as orfas, e o corpus sai curto
    sem ninguem ter escolhido isso. Tirando-as aqui, a cota fecha sobre material que pode
    ficar, e o deficit aparece como deficit em vez de como corpus menor.

    A pergunta e sobre o POOL HUMANO e nao sobre o corpus final: a selecao pode ainda
    cortar um pai, e `balanced_humans` recebe as ancoras exactamente para nao o fazer. O
    guarda de `drop_records_whose_parent_is_absent`, sobre os registros construidos, e o
    que prova que a combinacao das duas coisas fechou.

    O QUE ISTO MEDE NO MATERIAL DE HOJE, e e a razao de existir: 2.319 das 4.048 linhas
    `ai` em disco nomeiam uma semente que o pool humano nao tem, porque foram geradas
    pareadas com humanas de `ptso` e `carolina` — fontes que a moldura ja nao declara — e
    as 2.135 mistas nomeiam pais que vivem so em `reserved.jsonl`, que `load_humans`
    exclui e que nao sao expressaveis em v3 de qualquer modo. Sem esta funcao, uma
    montagem sobre esse material produz um corpus que o comando de split recusa.
    """
    presentes = {funnel_key(row) for row in humans}
    counts = {"ai-seed-absent": 0, "mixed-parent-absent": 0}
    ai_left: list[dict] = []
    for row in ai:
        seed = named_seed_identity(row)
        if seed is not None and seed not in presentes:
            counts["ai-seed-absent"] += 1
            continue
        ai_left.append(row)
    mixed_left: list[dict] = []
    for row in mixed:
        if parent_identity(row) not in presentes:
            counts["mixed-parent-absent"] += 1
            continue
        mixed_left.append(row)
    return ai_left, mixed_left, counts


def link_derived_to_parents(
    ai: list[dict], mixed: list[dict], humans: list[dict]
) -> dict[str, int]:
    """Resolve a referencia das DUAS classes derivadas na identidade do pai, in place.

    A classe `ai` estava de fora, e o cross-review mediu o custo: quando uma humana e
    renomeada, a linha gerada continua a nomear a cadeia antiga em `humanSeed`, e o corte
    de orfas — que compara com IDENTIDADES — lia-a como orfa e dropava-a. Uma geracao
    perdida por um renomeio que o linker sabia resolver.

    Devolve as contagens das duas, somadas por categoria: `resolved` e `repointed` contam
    linha derivada, e `unresolved` e o que o corte de orfas vai tirar.
    """
    counts = {"resolved": 0, "repointed": 0, "unresolved": 0}
    # CHAVEADO PELA REFERENCIA **E** PELA IDENTIDADE, e a segunda chave e o que faz desta
    # funcao idempotente: depois da primeira passagem `named_seed_identity` devolve o
    # carimbo, que e a IDENTIDADE, e um mapa so de referencias nao o encontraria — a
    # segunda chamada reportaria como orfa uma linha que a primeira resolveu, e o corte
    # de orfas dropava uma geracao boa. Medido antes de existir.
    identity_by_reference: dict[str, list[str]] = {}
    for human in humans:
        identidade = funnel_key(human)
        for chave in {group_axes.axis_token(human["candidateId"]), identidade}:
            identity_by_reference.setdefault(chave, []).append(identidade)
    for row in ai:
        seed = named_seed_identity(row)
        if seed is None:
            continue
        identities = identity_by_reference.get(seed, [])
        if len(identities) > 1:
            raise ParentIdentityAmbiguous(
                f"a linha gerada {funnel_key(row)!r} nomeia a semente {seed!r}, e o pool "
                f"humano tem {len(identities)} linhas com esse `candidateId` "
                f"({', '.join(identities)}). Qual delas e a semente nao esta no dado"
            )
        if not identities:
            counts["unresolved"] += 1
            continue
        counts["resolved"] += 1
        if identities[0] != seed:
            counts["repointed"] += 1
        row[PARENT_IDENTITY_FIELD] = slug(identities[0])
    mistas = link_mixed_to_parents(mixed, humans)
    for chave in counts:
        counts[chave] += mistas[chave]
    return counts


def link_mixed_to_parents(mixed: list[dict], humans: list[dict]) -> dict[str, int]:
    """Resolve a referencia de cada mista na IDENTIDADE do pai, in place.

    Corre DEPOIS de `enforce_unique_keys`, e existe por causa do unico caso em que a
    referencia e a identidade do pai deixam de coincidir: o pai foi renomeado porque
    outra linha tomou a chave primeiro. Sem resolucao, `derivationRoot` continuaria a
    nomear a cadeia antiga — que agora pertence a OUTRO registro —, e a uniao do split
    ligaria a mista ao registro errado sem dizer nada.

    RECUSA quando a referencia resolve em mais de uma linha humana: qual delas e o pai
    nao esta no dado, e escolher a primeira seria inventar a linhagem. Nao encontrar
    NENHUMA e resultado legitimo — o pai pode ter caido na poda, ou ser uma reservada que
    `load_humans` exclui de proposito — e por isso e contado e nao levantado.
    """
    identity_by_reference: dict[str, list[str]] = {}
    for human in humans:
        identity_by_reference.setdefault(human["candidateId"], []).append(
            funnel_key(human)
        )
    counts = {"resolved": 0, "repointed": 0, "unresolved": 0}
    for row in mixed:
        reference = parent_key(row)
        identities = identity_by_reference.get(reference, [])
        if len(identities) > 1:
            raise ParentIdentityAmbiguous(
                f"a linha mista {funnel_key(row)!r} nomeia o pai {reference!r}, e o pool "
                f"humano tem {len(identities)} linhas com esse `candidateId` "
                f"({', '.join(identities)}). Qual delas e o pai nao esta no dado, e "
                "escolher uma escreveria linhagem que ninguem mediu"
            )
        if not identities:
            counts["unresolved"] += 1
            continue
        counts["resolved"] += 1
        if identities[0] != reference:
            counts["repointed"] += 1
        row[PARENT_IDENTITY_FIELD] = slug(identities[0])
    return counts


def drop_records_whose_parent_is_absent(
    records: list[dict],
) -> tuple[list[dict], dict[str, int]]:
    """Os registros derivados cujo pai NAO esta no corpus saem, contados por razao.

    POR QUE SAIR e nao ser contado e mantido, que era o que esta funcao substitui:
    `assertDerivedParentsResolve` (`benchmark/schema.ts`) recusa o corpus INTEIRO por um
    destes, e o sitio que a chama e o comando de split (`benchmark/commands/split.ts`).
    Manter a linha nao guardava material — trocava uma linha perdida por uma montagem
    inteira recusada, um comando depois, com a mensagem a nomear o esquema em vez do
    funil.

    DUAS PERGUNTAS, que sao as duas que o guarda selado faz sobre presenca: o pai existe
    entre os ids escritos, e — so para `humanSeed` — ele e humano. A terceira pergunta de
    la, `labelBasis` no pai, NAO e feita aqui e a razao e construcao: `human_record`
    recusa (`MissingLabelEvidence`) a linha humana que nao o produz, entao um registro
    humano escrito por este montador carrega-o sempre. Repeti-la seria uma segunda
    autoridade sobre um facto que o construtor ja garante.

    O caso que isto fecha em MATERIAL: as 2.135 mistas em disco nomeiam pais que vivem so
    em `reserved.jsonl`, e `load_humans` exclui exactamente esses (`r["id"] not in
    parents`) — e nenhuma linha reservada e expressavel em v3 de qualquer modo, porque nao
    carrega licenca, data nem eixos. Entao TODA mista de hoje tem o pai ausente por
    construcao, e sem esta funcao a montagem produzia um corpus que o split recusa.
    """
    by_id = {record["id"]: record for record in records}
    counts = {"parent-absent": 0, "parent-not-human": 0}
    kept: list[dict] = []
    for record in records:
        if record.get("label") == "human":
            kept.append(record)
            continue
        motivo: str | None = None
        for axis in SPLIT_PARENT_LINKAGE_AXES:
            named = group_axes.identity_of((record.get("groups") or {}).get(axis))
            if named is None:
                continue
            # A AUTO-REFERENCIA E SALTADA SO EM `derivationRoot`, e a assimetria e a do
            # guarda selado: la, `humanSeed` exige que o apontado seja HUMANO, e um
            # registro gerado que se aponte a si proprio falha essa condicao. Saltar a
            # auto-referencia nos dois eixos — como esta funcao fazia — deixava passar
            # exactamente a linha gerada cuja semente e o proprio id, que e o estado em
            # que ela nao tem pai humano nenhum.
            if named == record["id"]:
                if axis == "derivationRoot":
                    continue
                motivo = "parent-not-human"
                break
            parent = by_id.get(named)
            if parent is None:
                motivo = "parent-absent"
                break
            # `derivationRoot` admite pai gerado — uma parafrase de uma geracao e cadeia
            # legitima —, e so `humanSeed` tem classe a satisfazer.
            if axis == "humanSeed" and parent.get("label") != "human":
                motivo = "parent-not-human"
                break
        if motivo is None:
            kept.append(record)
        else:
            counts[motivo] += 1
    return kept, counts


def parent_identity(row: dict) -> str:
    """A identidade do pai desta mista, resolvida se `link_mixed_to_parents` correu.

    O `slug` da referencia e o valor de partida e nao um valor de recurso: quando o pai
    nao foi renomeado, os dois sao a mesma cadeia, e quando o pai nao esta no pool nao ha
    identidade a apontar — `named in ids` do splitter recusa o valor, que e o desfecho
    correcto para uma linhagem cujo outro extremo nao esta no corpus.
    """
    return row.get(PARENT_IDENTITY_FIELD) or slug(parent_key(row))



# --- a triagem de PII por censo, dentro do funil -----------------------------------
#
# A POSICAO, e ela resolve cota e cegueira de uma vez: a projecao e tomada depois da
# ultima poda determinística (dedup exacto, poda de quase-duplicata, poda contra o corpus
# morto), depois de `enforce_unique_keys` e depois do filtro de expressabilidade — uma
# linha que o construtor recusa nao pode entrar no corpus, entao nao paga chamada —, e
# ANTES da selecao, da cota e do split. Logo
# um drop nunca quebra a cota exacta — 4.000/4.000/2.000 fecham sobre linhas ja triadas —
# e a barreira das duas cegas nao e tocada, porque pre-split nao ha particao.
#
# O QUE ESTE MODULO E DONO, e o outro nao: o DIGESTO. `norm_hash` e a regra selada, a
# mesma que a ingestao aplica antes de gravar `normalizedTextSha256`, entao o par
# `(chave, digesto)` do ledger e re-derivavel do `records.jsonl` por quem quer que seja.
# `pii_screen` recebe o par ja formado e nunca o recalcula.

SCREEN_FILTER = "llm-pii-screen"
SCREEN_IMPLEMENTATION = "benchmark/lab/pii_screen.py:screen_census"

# Onde o snapshot NAO pode ser escrito. Ele carrega TEXTO, e o texto de origem pode conter
# PII real; D-4 manda os logs da triagem para `benchmark/data/`, que e gitignored. As
# arvores abaixo sao rastreadas, e `benchmark/data` e a excecao dentro da primeira.
TRACKED_TREES = ("benchmark", "docs", "src", "contracts", "scripts", "tests")


class SnapshotPathIsTracked(RuntimeError):
    """O snapshot ia para um caminho rastreado pelo git. Ele carrega texto de origem."""


class ProjectionKeyCollision(RuntimeError):
    """Duas linhas de pool com a MESMA chave de funil chegaram a projecao."""


class SurvivorsBelowQuota(RuntimeError):
    """Depois do drop, os sobreviventes de uma classe nao alcancam a cota dela."""


class ScreeningDrop:
    """O resultado do drop: os tres pools que ficam, e as contagens por categoria."""

    def __init__(
        self, humans: list[dict], ai: list[dict], mixed: list[dict], counts: dict
    ):
        self.humans = humans
        self.ai = ai
        self.mixed = mixed
        self.counts = counts


def screening_projection(
    humans: list[dict], ai: list[dict], mixed: list[dict]
) -> list[pii_screen.ProjectionRow]:
    """A projecao de entrada da triagem: `(chave, digesto, texto)` por linha de pool.

    A ordem e a do funil — `ai`, `mixed`, `humans` —, a mesma que `near_dupes.prune` e
    `enforce_unique_keys` usam, para que a projecao de duas corridas sobre os mesmos pools
    seja byte a byte a mesma e o digesto I nao se mova sem o conteudo mover.
    """
    rows: list[pii_screen.ProjectionRow] = []
    seen: dict[str, str] = {}
    for pool in (ai, mixed, humans):
        for row in pool:
            key = funnel_key(row)
            _, digest = norm_hash(row["text"])
            # O SNAPSHOT E LEGIVEL POR ID, e esta e a linha que o impoe: duas linhas com
            # a mesma chave e textos diferentes tornariam o par unico e o snapshot
            # ambiguo, e o ledger de disposicoes deixaria de identificar QUAL delas
            # passou. Acontece quando duas linhas do mesmo pool nomeiam a mesma
            # identidade — o caso que `enforce_unique_keys` resolve, e por isso a
            # projecao e tomada depois dele.
            if key in seen and seen[key] != digest:
                raise ProjectionKeyCollision(
                    f"duas linhas de pool chegaram a projecao com a chave {key!r}: a "
                    "triagem corre DEPOIS de enforce_unique_keys, nunca antes"
                )
            seen[key] = digest
            rows.append(
                pii_screen.ProjectionRow(
                    row_id=key, text_sha256=digest, text=row["text"]
                )
            )
    return rows


def assert_the_snapshot_path_is_not_tracked(path: Path) -> None:
    resolved = Path(path).resolve()
    repo = Path(__file__).resolve().parents[2]
    try:
        relative = resolved.relative_to(repo)
    except ValueError:
        return  # fora do repositorio: o caminho e do operador
    parts = relative.parts
    if not parts:
        return
    if parts[0] == "benchmark" and len(parts) > 1 and parts[1] == "data":
        return
    if parts[0] in TRACKED_TREES:
        raise SnapshotPathIsTracked(
            f"o snapshot de triagem carrega TEXTO de origem e {relative.as_posix()} esta "
            "numa arvore rastreada. Escreva-o sob benchmark/data/ (gitignored) ou fora do "
            "repositorio, como D-4 manda para os logs da triagem"
        )


def emit_screening_snapshot(
    path: Path, projection: list[pii_screen.ProjectionRow]
) -> str:
    """Escreve a projecao e devolve o digesto I (sha256 dos bytes escritos)."""
    assert_the_snapshot_path_is_not_tracked(path)
    body = "".join(
        json.dumps(
            {"id": row.row_id, "textSha256": row.text_sha256, "text": row.text},
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n"
        for row in projection
    )
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(body)
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def drop_the_flagged(
    humans: list[dict], ai: list[dict], mixed: list[dict], ledger: dict
) -> ScreeningDrop:
    """D-12: todo sinalizado sai. E a mista cujo PAI saiu sai com ele.

    A COBERTURA e exigida primeiro: sem ela o drop leria ausencia como `passed`, que e o
    unico erro desta funcao capaz de deixar material nao triado dentro do corpus.

    A CASCATA e categoria propria na contagem, e nao um somatorio com os sinalizados: a
    mista nao foi sinalizada, saiu porque o pai saiu, e somar as duas esconderia o custo
    de um falso positivo no pai. Ela liga-se ao pai pela REFERENCIA — `parentId` contra o
    `candidateId` da linha humana —, e a ligacao vale em qualquer ponto do caminho porque
    nada no funil reescreve nenhum dos dois.

    E A CASCATA ALCANCA A CLASSE `ai`, que e a metade que faltava. Uma linha gerada nomeia
    a semente humana em `humanSeed`, e `assertDerivedParentsResolve` recusa o corpus cujo
    valor de la nao seja id de registro presente: dropar o pai e deixar a geracao dentro
    produzia um corpus que o comando de split recusa. As duas cascatas sao contadas
    SEPARADAMENTE porque custam material diferente — uma mista e barata de regerar do
    mesmo pai, uma geracao e uma chamada paga.

    A mista cujo pai NAO RESOLVE no pool humano e contada em `parent-unresolved` e fica.
    Uma ligacao quebrada tem de ser um numero: contada como zero na cascata, ela leria como
    "nenhum pai sinalizado", que e afirmacao e nao ausencia de dado.
    """
    projection = screening_projection(humans, ai, mixed)
    pii_screen.assert_the_ledger_covers(projection, ledger)

    def kept(row: dict) -> bool:
        _, digest = norm_hash(row["text"])
        return ledger[(funnel_key(row), digest)].disposition == "passed"

    flagged_parent_references = {
        row["candidateId"] for row in humans if not kept(row)
    }
    flagged_count = sum(
        1 for pool in (ai, mixed, humans) for row in pool if not kept(row)
    )

    humans_left = [row for row in humans if kept(row)]
    ai_survived = [row for row in ai if kept(row)]
    mixed_survived = [row for row in mixed if kept(row)]

    # A cascata da classe `ai`: a semente e comparada com a IDENTIDADE da humana, porque
    # e a identidade que vira id de registro e e ela que o eixo nomeia.
    surviving_seeds = {funnel_key(row) for row in humans_left}
    all_seeds = {funnel_key(row) for row in humans}
    ai_left: list[dict] = []
    ai_cascaded = 0
    for row in ai_survived:
        seed = named_seed_identity(row)
        if seed is not None and seed in all_seeds and seed not in surviving_seeds:
            ai_cascaded += 1
            continue
        ai_left.append(row)

    human_references = {row["candidateId"] for row in humans}
    cascaded = 0
    unresolved = 0
    mixed_left: list[dict] = []
    for row in mixed_survived:
        parent = parent_key(row)
        if parent not in human_references:
            unresolved += 1
            mixed_left.append(row)
            continue
        if parent in flagged_parent_references:
            cascaded += 1
            continue
        mixed_left.append(row)

    counts = {
        "screened": len(projection),
        "flagged": flagged_count,
        "cascade-ai-seed-flagged": ai_cascaded,
        "cascade-parent-flagged": cascaded,
        "parent-unresolved": unresolved,
    }
    return ScreeningDrop(humans_left, ai_left, mixed_left, counts)


def assert_the_screen_passed_every_selected_record(
    built: list[tuple[str, dict]], ledger: dict
) -> None:
    """D-13 + D-19: por registro selecionado, `disposition == "passed"` no ledger.

    O digesto e RECOMPUTADO do texto do registro escrito, e nao reusado da projecao: se o
    texto mudou entre o snapshot e o registro, o par nao casa e a linha e recusada. E o
    risco que o perfil declara como "mutacao de bytes", e reusar o digesto da projecao
    seria exactamente nao o verificar.
    """
    pairs = [(key, norm_hash(record["text"])[1]) for key, record in built]
    pii_screen.assert_selected_records_passed(pairs, ledger)


def stamp_the_screen_run(record: dict) -> None:
    """Estampa a corrida `llm-pii-screen` no registro, DEPOIS da guarda ter passado.

    A ORDEM e a guarda: `outcome: "passed"` so pode ser escrito depois de a disposicao ter
    sido conferida, senao o selo seria a afirmacao e nao a consequencia dela.

    Idempotente, porque uma corrida gravada duas vezes contaria duas vezes em qualquer
    tabela por filtro. O `state` NAO muda: um filtro nao e uma revisao, e o registro
    continua `automated/unreviewed` — que e o que `reviewClaimSupport` le.
    """
    filters = record["review"]["automatedFilters"]
    if any(entry.get("filter") == SCREEN_FILTER for entry in filters):
        return
    filters.append(
        {
            "filter": SCREEN_FILTER,
            "implementation": SCREEN_IMPLEMENTATION,
            "outcome": "passed",
        }
    )


class BuilderRefusalAfterTheFilter(RuntimeError):
    """Um construtor recusou linha que o filtro de expressabilidade tinha aprovado.

    Nao e recusa de material: e DESACORDO entre duas execucoes do mesmo construtor sobre
    a mesma linha, e um desacordo aqui significa que o filtro e o construtor deixaram de
    ser a mesma autoridade. Levanta em vez de contar, porque contar deixaria a cota curta
    outra vez pela razao que o filtro existe para fechar.
    """


def assert_the_builders_agree_with_the_filter(
    refused: Mapping[str, int], examples: Mapping[str, str]
) -> None:
    """O construtor da montagem recusou linha que o filtro aprovou. NAO e recusa de
    material: e desacordo entre duas execucoes do MESMO construtor sobre a mesma linha, e
    um desacordo aqui significa que o filtro e o construtor deixaram de ser a mesma
    autoridade.

    Levanta em vez de contar, porque contar deixaria a cota curta outra vez pela razao que
    o filtro existe para fechar. Funcao nomeada e nao um `if` em `main()`: por construcao
    nenhuma entrada real a alcanca — as duas chamadas sao do mesmo construtor —, entao a
    unica maneira de a exercitar e chama-la, e uma guarda sem entrada de teste e a familia
    de defeito que a § 7 do ESTADO nomeia.
    """
    if not refused:
        return
    primeiro = next(iter(examples.values()), "") if examples else ""
    raise BuilderRefusalAfterTheFilter(
        "o filtro de expressabilidade aprovou linha(s) que o construtor recusou na "
        f"montagem: {dict(refused)}. Ex.: {primeiro[:200]}"
    )


def partition_by_expressibility(
    rows: list[dict], make
) -> tuple[list[dict], Counter, dict[str, str]]:
    """As linhas que o construtor CONSEGUE expressar, e as recusas contadas por razao.

    POR QUE ANTES DA SELECAO, e nao depois como era. Duas consequencias, medidas:

      * a COTA. `balanced_humans` escolhia 4.000 linhas de um pool que continha linhas
        que o construtor ia recusar, e o corpus saia curto — as reservadas, por exemplo,
        entram no pool com `domainSource` em moldura e sao TODAS recusadas
        (`MissingDocumentLicense` e a primeira das quatro). A cota era preenchida com
        linhas que desapareciam depois;
      * o DINHEIRO. A projecao do censo e tomada dos pools, entao cada uma dessas linhas
        pagava uma chamada de triagem para nao poder entrar no corpus de nenhum modo. Uma
        conta antes de uma chamada paga.

    O construtor e o MESMO que a montagem usa depois — passado como `make` e nao
    reimplementado —, porque duas regras de "esta linha e expressavel?" poderiam
    discordar, e a que decide a cota tem de ser a que decide o registro.
    """
    kept: list[dict] = []
    refused: Counter = Counter()
    examples: dict[str, str] = {}
    for row in rows:
        try:
            make(row)
        except UnwritableInV3 as error:
            reason = type(error).__name__
            refused[reason] += 1
            examples.setdefault(reason, str(error))
            continue
        kept.append(row)
    return kept, refused, examples


def assert_the_survivors_meet_the_quota(
    *, survivors: dict[str, int], counts: dict[str, int]
) -> None:
    """D-15 + D-21: o preflight sobre os SOBREVIVENTES, depois da ultima poda.

    `assert_the_reserve_target_fits` prova que o ALVO cabe na matriz; este prova que o que
    sobreviveu basta. Sao perguntas diferentes: a primeira e sobre o plano, a segunda sobre
    o material que chegou aqui depois de dedup, poda, poda global e drop de triagem.

    Nomeia TODAS as classes em falta e nao so a primeira, porque quem le precisa do tamanho
    do buraco inteiro antes de decidir regenerar uma pista.
    """
    short = {
        label: (survivors.get(label, 0), target)
        for label, target in counts.items()
        if survivors.get(label, 0) < target
    }
    if short:
        detail = ", ".join(
            f"{label} {have}/{want}" for label, (have, want) in sorted(short.items())
        )
        raise SurvivorsBelowQuota(
            f"os sobreviventes nao alcancam a cota depois da ultima poda: {detail}. O alvo "
            "caber na matriz e outra pergunta, e ja foi respondida antes da geracao"
        )


def dedup(records: list[dict], text_key, seen: set[str]) -> list[dict]:
    out = []
    for r in records:
        _, h = norm_hash(text_key(r))
        if h in seen:
            continue
        seen.add(h)
        out.append(r)
    return out


class HardNegativeCellUnderfilled(RuntimeError):
    """A cell cannot hand the tagging pass the rows the families drawn from it need.

    The failure it forestalls is silent: the pass takes `tag_per` rows per family out of
    that family's own cell, so a cell shorter than the sum of its families' demands leaves
    the last family with fewer rows — possibly none. A required family with no row at all
    is absent from the corpus, and `sealDataset` refuses a release corpus for it at the
    very end of the assembly.
    """


def hard_negative_demand_per_cell(tag_per: int) -> dict[str, int]:
    """How many DISTINCT human rows each cell has to hand the tagging pass.

    Families are STYLE families drawn from the cell `HN_REGISTER` points them at, and the
    demands of the families pointing at one cell ADD UP: two rows cannot carry two
    families. With a one-cell frame all six point at the same cell, so the demand on it is
    six times `tag_per` and this function is the only place that arithmetic is charged.
    """
    demand = {cell: 0 for cell in QUOTA_CELLS}
    for family in HARD_NEGATIVE_FAMILIES:
        demand[HN_REGISTER[family]] += tag_per
    return demand


def tag_hard_negatives(records: list[dict], tag_per: int) -> dict[str, int]:
    """Tags `tag_per` human rows per required family, from that family's own cell.

    Returns the count per family, and refuses BEFORE tagging anything when a cell cannot
    cover the families drawn from it — a partially tagged corpus would otherwise travel
    all the way to the seal to be refused there.
    """
    by_cell: dict[str, list[dict]] = {}
    for record in records:
        if record["label"] == "human":
            by_cell.setdefault(record["humanSourceType"], []).append(record)
    families_of: dict[str, list[str]] = {cell: [] for cell in QUOTA_CELLS}
    for family in HARD_NEGATIVE_FAMILIES:
        families_of[HN_REGISTER[family]].append(family)
    short = {
        cell: (len(by_cell.get(cell, [])), need)
        for cell, need in hard_negative_demand_per_cell(tag_per).items()
        if len(by_cell.get(cell, [])) < need
    }
    if short:
        detail = "; ".join(
            f"{cell} holds {have} human rows and the families drawn from it "
            f"({', '.join(families_of[cell])}) need {need}"
            for cell, (have, need) in sorted(short.items())
        )
        raise HardNegativeCellUnderfilled(
            f"{len(short)} cell(s) cannot carry their hard-negative families at "
            f"{tag_per} rows each: {detail}. A family that gets no row is absent from "
            "the corpus, and the release seal refuses a corpus missing a required "
            "hard-negative family"
        )
    tagged: dict[str, int] = {}
    used: set[int] = set()
    for family in HARD_NEGATIVE_FAMILIES:
        picked = 0
        for record in by_cell.get(HN_REGISTER[family], []):
            if id(record) in used or "hardNegativeFamily" in record:
                continue
            record["hardNegativeFamily"] = family
            used.add(id(record))
            picked += 1
            if picked >= tag_per:
                break
        tagged[family] = picked
    return tagged


def mixed_parents_by_frame(rows: list[dict]) -> tuple[dict[str, int], dict[str, int]]:
    """(mixed lines per in-frame parent CELL, mixed lines per out-of-frame parent).

    A mechanistic mixed line IS its parent's human text with generated stretches, so it is
    counted in the parent's cell. The two dicts partition the pool: the second one is the
    deficit `mixed_record` produces, per parent, which is the number that says WHICH
    parents a regeneration of the mixing lane has to draw on.
    """
    inside: Counter = Counter()
    outside: Counter = Counter()
    for row in rows:
        family = str(row.get("parentFamily") or "")
        cell = REGISTER.get(family)
        if cell is None:
            outside[family or "?"] += 1
        else:
            inside[cell] += 1
    return dict(inside), dict(outside)


class CellBelowOriginDocumentFloor(RuntimeError):
    """A quota cell whose pool cannot deliver the pre-registered number of draws.

    Stops the run, and it stops it BEFORE the assembly rather than at the composition
    gate: the gate runs on the finished corpus at sealing time, so the same refusal costs
    a whole extraction and assembly to hear.
    """


def power_floors(policy_path: Path = POLICY_PATH) -> dict[str, int]:
    """The pre-registered power floors, read and never retyped."""
    floors = json.loads(policy_path.read_text(encoding="utf-8"))["powerFloors"]
    return {name: int(value) for name, value in floors.items()}


def origin_documents_per_cell(cands: list[dict]) -> dict[str, int]:
    """Distinct `known` origin documents each cell's pool can draw on.

    The origin document is the `source` axis, which for Carolina is the MEMBER FILE and
    for Wikipedia the page. Rows naming no `known` source are not counted, and that is
    the gate's own arithmetic rather than a convenience: two lines that cannot be shown
    to come from different documents share ONE bucket of the per-document cap, so they
    are one draw and not two.
    """
    documents: dict[str, set[str]] = {cell: set() for cell in QUOTA_CELLS}
    for cand in cands:
        identity = group_axes.identity_of(
            ((cand.get("meta") or {}).get("groupAxes") or {}).get("source")
        )
        if identity is not None:
            documents[cell_of(cand)[0]].add(identity)
    return {cell: len(ids) for cell, ids in documents.items()}


def assert_cells_can_meet_the_origin_document_floor(
    cands: list[dict], floor: int | None = None
) -> None:
    """Refuses a human pool whose cells cannot reach the pre-registered floor of draws.

    NECESSARY and not sufficient, and the derivation is the reason it can be checked this
    early. `collection.maximumLinesPerOriginDocument` is 1, and every line of a cell whose
    origin document is unrecoverable falls into ONE shared bucket, so a cell holds at most
    (distinct origin documents) + 1 record-lines in the blind block — no matter how many
    rows its pool carries. A cell whose whole pool draws on fewer distinct documents than
    `powerFloors.samplingUnits` therefore cannot reach the floor of human negatives, and
    no re-selection or re-balancing changes it. What this does NOT decide is the blind
    block's own count: the floors are measured on `test` alone, and the split is what
    decides how the documents land.
    """
    if floor is None:
        floor = power_floors()["samplingUnits"]
    documents = origin_documents_per_cell(cands)
    short = {cell: n for cell, n in documents.items() if n < floor}
    if short:
        detail = ", ".join(f"{cell}={n}" for cell, n in sorted(short.items()))
        raise CellBelowOriginDocumentFloor(
            f"the pool draws on fewer than {floor} distinct origin documents in "
            f"{len(short)} of {len(documents)} cells ({detail}). One line per origin "
            "document is the pre-registered cap, so these cells cannot hold the "
            f"{floor} human negatives their published FPR ceilings are computed over. "
            "Either the extraction has to reach more origin documents or the "
            "granularity of the `source` axis has to be amended — and the second is a "
            "decision about the split's union, not about this pool"
        )


def balanced_humans(
    cands: list[dict], total: int, anchors: set[str] | None = None
) -> list[dict]:
    """`total` human lines split over the DECLARED cells, never across them.

    The quota is per cell because the claim is per cell: each cell publishes its own FPR
    ceiling over its own denominator of human negatives, so a line collected in one cell
    does not stand in for a line missing from another. That is why a short cell stays
    short here instead of being topped up out of a richer pool — the top-up reaches the
    total, spends the collection budget on material the missing cell's ceiling cannot
    use, and the composition gate refuses the seal at the end of the run anyway. The
    shortfall is printed by `main`, which is the number the operator has to act on.

    The denominator is the cells the FRAME declares, not the cells the pools happen to
    contain: dividing by what arrived is what spends a missing cell's budget on the cells
    that did arrive. With the ONE cell the frame declares the two denominators are the
    same number, so no corpus can tell them apart — the choice is written here and pinned
    in the frame's own list, and it starts biting again at the second cell (ESTADO § 7).

    A remainder the cells cannot divide goes to the first cells in name order, so a
    smoke run whose total is smaller than the number of cells still selects something,
    and selects it deterministically.

    `anchors` sao as identidades humanas que linhas GERADAS nomeiam como semente, e elas
    vao a frente DENTRO da celula. Nao e preferencia estetica: uma humana cortada pela
    cota leva consigo toda geracao que a nomeia (`assertDerivedParentsResolve` recusa o
    corpus cujo `humanSeed` nao resolva), e trocar uma linha humana — que ha de sobra, e
    e extraccao — por uma linha gerada — que e chamada paga — e trocar o barato pelo
    caro.
    A ordem RELATIVA dentro de cada grupo e preservada, entao a selecao continua
    determinista.
    """
    per_cell, remainder = divmod(total, len(QUOTA_CELLS))
    ancoras = anchors or set()
    by_cell: dict[str, list[dict]] = {cell: [] for cell in QUOTA_CELLS}
    for cand in cands:
        by_cell[cell_of(cand)[0]].append(cand)
    chosen: list[dict] = []
    for index, cell in enumerate(QUOTA_CELLS):
        rows = by_cell[cell]
        if ancoras:
            rows = [row for row in rows if funnel_key(row) in ancoras] + [
                row for row in rows if funnel_key(row) not in ancoras
            ]
        chosen.extend(rows[: per_cell + (1 if index < remainder else 0)])
    return chosen


def cluster_report_rows(records: list[dict]) -> list[dict]:
    """The projection `group_axes.cluster_report` reads, and the only one.

    `schemaVersion` is IN the projection because `group_axes.axes_of` branches on it:
    without it every v4 row is read against the v3 tuple, so the report publishes
    `collectionBatch` with `{"unknown": n}` and clusters 0, omits the three axes v4
    introduced, and counts every row as ineligible. A named function rather than a
    literal inside `main` so the report the tests exercise is the report the run
    writes — a projection tested only through a hand-written dict is a projection
    nothing checks.
    """
    return [
        {
            "schemaVersion": r["schemaVersion"],
            "id": r["id"],
            "label": r["label"],
            "partition": PARTITION_OF.get(r["id"], "unassigned"),
            "groups": r["groups"],
        }
        for r in records
    ]


class SourceCarriesTwoLicenses(RuntimeError):
    """One source's records declare more than one licence, and the manifest holds one.

    `ReviewedSourceEntryV1.licenseId` is a single string, so the reviewed source manifest
    can state exactly one licence per source. When the documents of one base declare two,
    every choice is a false statement about part of the rows, and picking the majority is
    the worst of them because it is invisible.

    This is a real limit and not a defensive check: Carolina declares availability per
    TEI document, so a package that ships two availabilities makes it reachable. Lifting
    it is a schema decision on the sealed side (a per-record licence path through the
    manifest), which is why the lab refuses instead of choosing.
    """


def source_licenses(records: Iterable[dict]) -> dict[str, str]:
    """sourceId -> the one licence its records declare, or a refusal.

    Derived from the records and not declared beside them: a constant per source is what
    D8 removed, and a second authority here could disagree with the licence the very rows
    it describes carry.
    """
    by_source: dict[str, set[str]] = {}
    for record in records:
        provenance = record["provenance"]
        by_source.setdefault(provenance["sourceId"], set()).add(provenance["licenseId"])
    resolved: dict[str, str] = {}
    for source_id, licenses in sorted(by_source.items()):
        if len(licenses) > 1:
            raise SourceCarriesTwoLicenses(
                f"the source {source_id!r} has records under {len(licenses)} licences "
                f"({', '.join(sorted(licenses))}), and the reviewed source manifest "
                "states one licence per source. Split the source, or take the licence "
                "to a per-record path in the manifest schema; naming one of the two here "
                "would publish it for rows that do not carry it"
            )
        resolved[source_id] = next(iter(licenses))
    return resolved


def used_license_inventory(records: Iterable[dict]) -> list[dict]:
    """The `licenses[]` inventory of the dataset manifest, projected from the records.

    Every licence some record carries and nothing else. Both directions matter: an
    inventory missing one refuses the whole corpus at the seal
    (`DATASET_LICENSE_INVALID`), and an inventory carrying one no row uses declares terms
    the corpus is not under.
    """
    used: dict[str, str] = {}
    for record in records:
        used.setdefault(record["provenance"]["licenseId"], record["id"])
    for license_id, record_id in sorted(used.items()):
        if license_id not in LICENSE_INVENTORY:
            raise UndecidedDocumentLicense(
                f"record {record_id!r} carries the licence {license_id!r}, which the "
                f"inventory has no entry for ({', '.join(sorted(LICENSE_INVENTORY))}). "
                "The seal refuses the whole corpus for a licence absent from "
                "`manifest.licenses[]`, so the entry is what has to exist — not this "
                "projection guessing a name and a URL for it"
            )
    return [
        {"id": license_id, **LICENSE_INVENTORY[license_id]}
        for license_id in sorted(used)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument(
        "--sample", type=int, default=0, help="montagem de fumaça: N registros totais"
    )
    parser.add_argument(
        "--candidates-dir",
        type=Path,
        default=CAND,
        help="pools de candidatos a ler (default: benchmark/data/candidates). "
        "Aponte para uma re-extração fresca; NÃO sobrescreva "
        "benchmark/data/corpus-build, que é a evidência da execução reprovada",
    )
    parser.add_argument(
        "--reserved",
        type=Path,
        default=DATASET / "reserved.jsonl",
        help="linhas humanas reservadas (nunca treinadas, nao pais de mistura). "
        "ARGUMENTO e nao caminho fixo: com o caminho fixo, uma corrida --sample sobre um "
        "--candidates-dir pequeno colhia as reservadas do disco real e pagava uma chamada "
        "de triagem por cada uma",
    )
    parser.add_argument(
        "--seen-index",
        type=Path,
        default=SEEN_INDEX_PATH,
        help="artefato do conjunto de vistos (hashes + shingles do corpus morto). "
        "Construa com `near_dupes.py build-seen-index`; uma montagem de release "
        "RECUSA sem ele",
    )
    parser.add_argument(
        "--emit-screening-snapshot",
        type=Path,
        default=None,
        help="escreve a projecao de entrada da triagem (id, sha256, TEXTO) e PARA. O "
        "arquivo carrega texto de origem, entao tem de ficar sob benchmark/data/ ou fora "
        "do repositorio (D-4)",
    )
    parser.add_argument(
        "--pii-screen-ledger",
        type=Path,
        default=None,
        help="ledger de disposicoes de uma execucao do llm-pii-screen. AUSENTE e "
        "legitimo: a montagem corre sem triagem, os registros nao carregam a corrida, e o "
        "selo recusa `release` sob o perfil de censo um passo depois — que e o sitio com "
        "autoridade para isso",
    )
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    # The slate before the pools: two contradictory role lists cannot produce a right
    # corpus, and the contradiction is cheap to hear now and expensive after an assembly.
    assert_slate_roles_are_consistent()

    counts = (
        {"human": round(args.sample * 0.4), "ai": round(args.sample * 0.4),
         "mixed": args.sample - 2 * round(args.sample * 0.4)}
        if args.sample
        else dict(TARGET)
    )

    seen: set[str] = set()
    humans = dedup(
        load_humans(args.candidates_dir, args.reserved), lambda r: r["text"], seen
    )
    ai = dedup(load_ai(args.candidates_dir), lambda r: r["text"], seen)
    mixed = dedup(load_mixed(args.candidates_dir), lambda r: r["text"], seen)
    print(f"pools (dedup): human={len(humans)} ai={len(ai)} mixed={len(mixed)}")

    # Exact-hash dedup is not enough: ingest refuses EVERY member of a
    # near-duplicate cluster that straddles more than one lineage, and our
    # derivationRoots are unique per record, so a surviving near-dup pair costs
    # us both records. Prune to one representative per cluster, across all three
    # pools at once (a human and its AI paraphrase is exactly the dangerous
    # case). AI is the scarcest class, so it outranks mixed, which outranks the
    # human surplus.
    # A DESAMBIGUACAO VEM ANTES DAS PODAS, e o cross-review mediu por que. `prune` e
    # `drop_seen_against` devolvem CONJUNTOS DE NOMES, e o montador filtra os pools por
    # pertenca a esses conjuntos: duas linhas que cheguem ali com a mesma identidade vivem
    # e morrem juntas, mesmo em clusters diferentes. E chegar com a mesma identidade nao e
    # excepcional — duas mistas do mesmo pai (o funil le dois arquivos), duas lanes `ai`
    # que pediram o mesmo pai (295 colisoes medidas no material). Desambiguando primeiro,
    # todo nome que as podas devolvem nomeia UMA linha.
    renames = enforce_unique_keys([ai, mixed, humans])
    if renames:
        print(f"ids desambiguados (colisao entre lanes): {len(renames)}")

    # A chave das podas e a IDENTIDADE, e nunca a referencia: com a mista chaveada pelo
    # pai, o nome devolvido nomeava tambem o pai, e a poda que escolhe guardar a mista e
    # derrubar o pai derrubava as duas — pai e mista sao quase-duplicatas por construcao,
    # que e exactamente o cluster onde isso morde.
    key = funnel_key

    docs = (
        [(key(r), r["text"], 0) for r in ai]
        + [(key(r), r["text"], 1) for r in mixed]
        + [(key(r), r["text"], 2) for r in humans]
    )
    dropped, nd_stats = near_dupes.prune(docs)
    if dropped:
        humans = [r for r in humans if key(r) not in dropped]
        ai = [r for r in ai if key(r) not in dropped]
        mixed = [r for r in mixed if key(r) not in dropped]
    print(f"near-dup prune: {nd_stats}")
    print(f"pools (near-dup): human={len(humans)} ai={len(ai)} mixed={len(mixed)}")

    # Prune what the dead corpus already contains, under a stated contract: exact
    # tokenized content plus Jaccard >= 0.82 over 5-token shingles. That contract is NOT
    # independence between the two corpora — paraphrase and shared subject matter pass it
    # — and no report may call it that (R7). What it does catch is the overlap pruning
    # WITHIN the corpus cannot see: the human pools re-extract the same upstream sources
    # the dead corpus was built from, so a revisited page reappears with small edits and
    # reads as fresh here while its content has already been exposed.
    if args.seen_index.exists():
        index, seen_header = near_dupes.read_seen_index(args.seen_index)
        if not args.sample:
            assert_the_seen_index_covers_the_dead_corpus(seen_header)
        contaminated, seen_stats = near_dupes.drop_seen_against(
            [(key(r), r["text"]) for r in humans + ai + mixed], index
        )
        if contaminated:
            humans = [r for r in humans if key(r) not in contaminated]
            ai = [r for r in ai if key(r) not in contaminated]
            mixed = [r for r in mixed if key(r) not in contaminated]
        print(f"vazamento vs corpus morto: {seen_stats}")
    elif not args.sample:
        raise SeenIndexMissing(
            f"no seen-set artifact at {args.seen_index}. Build it first:\n"
            "  py -3.13 near_dupes.py build-seen-index "
            "--records ../data/corpus-build/dataset/records.jsonl "
            f"--out {args.seen_index}"
        )
    else:
        print(f"!! sem indice de vistos em {args.seen_index}: fumaca sem poda global")

    # A REFERENCIA SEGUE O REFERENTE PRIMEIRO, e a ordem foi medida: o corte de orfas
    # compara com IDENTIDADES, entao corre-lo antes da ligacao lia como orfa toda linha
    # derivada cujo pai foi renomeado — e dropava a geracao que o linker resolveria.
    linked = link_derived_to_parents(ai, mixed, humans)
    print(f"ligacao pai/derivada: {linked}")

    # AS ORFAS SAEM ANTES DA SELECAO: linha derivada sem pai no pool nao pode entrar no
    # corpus, e ocupar cota com ela e fazer o corpus sair curto sem ninguem escolher isso.
    ai, mixed, orphans = drop_orphan_derived_rows(humans, ai, mixed)
    if any(orphans.values()):
        print(
            f"!! linhas derivadas sem pai no pool humano (SAEM antes da cota): {orphans}"
        )
        print(
            "   a geracao tem de ser pareada com as humanas que o corpus vai conter: "
            "`assertDerivedParentsResolve` recusa o corpus cujo `humanSeed` ou "
            "`derivationRoot` nao resolva"
        )
    print(f"pools (com pai): human={len(humans)} ai={len(ai)} mixed={len(mixed)}")


    # A CONTA ANTES DA CHAMADA PAGA, e ela vem antes da projecao de proposito: uma linha
    # que o construtor recusa nao pode entrar no corpus por caminho nenhum, entao nao pode
    # ocupar cota nem pagar uma chamada de triagem.
    refused_total: Counter = Counter()
    refused_all: dict[str, str] = {}
    for label, pool, make in (
        ("human", humans, lambda c: human_record(c, cell_of(c)[0], None)),
        ("ai", ai, ai_record),
        ("mixed", mixed, mixed_record),
    ):
        kept, refused, examples = partition_by_expressibility(pool, make)
        if refused:
            print(f"!! {label}: linhas que a v3 nao consegue expressar (saem antes da")
            print("   projecao, entao nao ocupam cota nem pagam chamada de triagem):")
            for reason, count in sorted(refused.items()):
                print(f"   {reason}: {count} — ex.: {examples[reason][:160]}")
        refused_total.update(refused)
        for reason, example in examples.items():
            refused_all.setdefault(reason, example)
        if label == "human":
            humans = kept
        elif label == "ai":
            ai = kept
        else:
            mixed = kept
    print(f"pools (expressaveis): human={len(humans)} ai={len(ai)} mixed={len(mixed)}")

    # A TRIAGEM DE PII POR CENSO, e esta e a posicao: depois da ultima poda
    # determinística, da desambiguacao e do filtro de expressabilidade, antes da selecao,
    # da cota e do split.
    projection = screening_projection(humans, ai, mixed)
    if args.emit_screening_snapshot is not None:
        digest = emit_screening_snapshot(args.emit_screening_snapshot, projection)
        print(
            f"snapshot de triagem: {len(projection)} pares em "
            f"{args.emit_screening_snapshot}"
        )
        print(f"digesto I: {digest}")
        print(
            "a montagem PAROU aqui de proposito: triar e o passo seguinte, e o ledger "
            "dele volta por --pii-screen-ledger"
        )
        return
    screen_ledger: dict | None = None
    if args.pii_screen_ledger is not None:
        screen_ledger = pii_screen.read_ledger(args.pii_screen_ledger)
        dropped = drop_the_flagged(humans, ai, mixed, screen_ledger)
        humans, ai, mixed = dropped.humans, dropped.ai, dropped.mixed
        print(f"triagem de PII (censo): {dropped.counts}")
        if dropped.counts["parent-unresolved"]:
            print(
                f"!! mistas cujo pai nao resolve no pool humano: "
                f"{dropped.counts['parent-unresolved']} — a cascata nao as alcanca, e o "
                "numero esta aqui para nao ler como zero"
            )
        print(
            f"pools (pos-triagem): human={len(humans)} ai={len(ai)} mixed={len(mixed)}"
        )
        if not args.sample:
            # D-15 + D-21: os SOBREVIVENTES, e so quando a triagem correu. Sem ela o
            # deficit continua a ser o aviso impresso no fim, que e o comportamento
            # pre-existente; converte-lo em recusa e decisao sobre o montador, e nao
            # sobre a triagem.
            assert_the_survivors_meet_the_quota(
                survivors={
                    "human": len(humans),
                    "ai": len(ai),
                    "mixed": len(mixed),
                },
                counts=counts,
            )
    else:
        print(
            "!! sem ledger de triagem: nenhuma linha foi triada por censo, e nenhum "
            "registro carrega a corrida llm-pii-screen. Um selo `release` sob "
            "census-pii-screen-v1 sera RECUSADO"
        )

    # Within the reproducibility order, push records whose topic seed is already
    # taken to the END, so the quota truncation drops them FIRST. Two lanes asked
    # for the same human parent (sibling lanes only dedupe against their own
    # output), which repeats a topic inside the AI class without repeating text
    # — measured jaccard median 0.048, max 0.430, far under the 0.82 refusal bar.
    # They are kept while the class is short and displaced as soon as it is not.
    seen_parents: set[str] = set()
    unique_parent, repeat_parent = [], []
    for row in ai:
        parent = (row.get("meta") or {}).get("pairedWith")
        if parent and parent in seen_parents:
            repeat_parent.append(row)
            continue
        if parent:
            seen_parents.add(parent)
        unique_parent.append(row)
    if repeat_parent:
        print(f"pais de topico reusados (descartados primeiro): {len(repeat_parent)}")
    ai = unique_parent + repeat_parent

    documents = origin_documents_per_cell(humans)
    print(f"documentos de origem distintos por celula: {documents}")
    if not args.sample:
        # Only against the RELEASE quota: the pre-registered floor is a count over the
        # corpus a release is sealed on, and a `--sample` run collects a fraction of that
        # quota by construction, so comparing a smoke against it would refuse every smoke
        # for the one reason that is not a defect.
        assert_cells_can_meet_the_origin_document_floor(humans)

    inside, outside = mixed_parents_by_frame(mixed)
    print(f"mistas por celula do pai: {inside}")
    if outside:
        print(f"!! mistas cujo pai esta fora da moldura (saem): {outside}")
    mixed_shortfall = counts["mixed"] - sum(inside.values())
    if mixed_shortfall > 0:
        print(
            f"!! classe mista {mixed_shortfall} linhas abaixo da cota de "
            f"{counts['mixed']}: o selo compara por igualdade exata, entao a lane de "
            "mistura tem de ser regerada a partir de pais nas celulas da moldura "
            f"({', '.join(QUOTA_CELLS)})"
        )

    # AS CLASSES GERADAS PRIMEIRO, e a ordem e a razao: elas sao truncadas por cota
    # independentemente das humanas, e o que elas nomeiam decide quais humanas tem de
    # ficar. Selecionar as humanas primeiro era escolher sem saber o que se ia perder.
    ai_sel = ai[: counts["ai"]]
    mixed_sel = mixed[: counts["mixed"]]
    anchors = {
        seed
        for seed in (named_seed_identity(row) for row in ai_sel)
        if seed is not None
    }
    anchors |= {parent_identity(row) for row in mixed_sel}
    human_sel = balanced_humans(humans, counts["human"], anchors)

    # Every builder can REFUSE a row now, and a refusal is counted rather than
    # swallowed or worked around. This is where the v2 corpus's hidden debt becomes
    # visible: v2 accepted a generated row with no lane, no template digest and no
    # effort, and a human row with no date evidence, because it asked for none of
    # them. v3 asks, so those rows leave — and the count below is the honest size of
    # what has to be re-extracted or regenerated, which is exactly the number a
    # `?? 0`-style substitution would have hidden.
    evidence_entries: list[dict] = []
    refused: Counter = Counter()
    refused_examples: dict[str, str] = {}
    # A chave do funil por id de registro, para a guarda da triagem poder juntar o
    # registro escrito ao par do ledger. Guardada aqui e nao recomputada depois: o id do
    # registro e derivado da chave, mas por uma regra que cada construtor tem a sua, e
    # uma segunda derivacao seria uma segunda regra capaz de discordar.
    funnel_key_by_record: dict[str, str] = {}

    def build(rows: list[dict], make) -> list[dict]:
        out: list[dict] = []
        for row in rows:
            try:
                record = make(row)
            except UnwritableInV3 as error:
                reason = type(error).__name__
                refused[reason] += 1
                refused_examples.setdefault(reason, str(error))
                continue
            funnel_key_by_record[record["id"]] = funnel_key(row)
            out.append(record)
        return out

    records = build(
        human_sel,
        lambda c: human_record(
            c, cell_of(c)[0], None, evidence_sink=evidence_entries
        ),
    )
    records += build(ai_sel, ai_record)
    records += build(mixed_sel, mixed_record)
    assert_the_builders_agree_with_the_filter(refused, refused_examples)

    # O PAI AUSENTE SAI AQUI, antes de qualquer contagem: `assertDerivedParentsResolve`
    # recusa o corpus inteiro por um destes, e o sitio que a chama e o comando de split.
    # Contar e continuar trocava uma linha perdida por uma montagem recusada um comando
    # depois. Depois da construcao porque a pergunta e sobre ids ESCRITOS, e antes de
    # `tag_hard_negatives` pela razao que a exclusao de familia tem: linha que o corpus
    # nao vai conter nao entra no denominador de ninguem.
    records, absent = drop_records_whose_parent_is_absent(records)
    if any(absent.values()):
        print(
            "!! registros derivados cujo pai nao esta no corpus (SAEM, porque o split "
            f"recusaria o corpus inteiro): {absent}"
        )

    tagged = tag_hard_negatives(records, max(1, counts["human"] // 200))
    print(f"hard-negatives etiquetados por familia: {tagged}")

    # The reserve, from the slate and not from a name predicate. Every generated family
    # is classified by DECLARATION — a family no role names stops the run here — and the
    # reserved ones are the held-out set: they are seated whole in the blind block, and
    # the split refuses any of their lines that realizes anywhere else. The excluded ones
    # leave here, BEFORE the per-family counts, so no later arithmetic is computed over
    # rows the corpus will not contain.
    roles = generator_family_roles(records)
    records, excluded_rows = drop_excluded_families(records, roles)
    if excluded_rows:
        print(
            "!! familias excluidas pelo slate — as linhas SAEM do corpus "
            f"({sum(excluded_rows.values())} no total): {excluded_rows}"
        )
        for family in excluded_rows:
            print(f"   {family}: {EXCLUDED_GENERATOR_FAMILIES[family]}")

    # THE ANTI-ARTIFACT GATE (A4/D13), and this is what "pre-training" means for it: the
    # training set is `train.jsonl` of the split, and the split is cut from these records,
    # so a corpus that gets past here is a corpus a training run may read.
    #
    # After the excluded families and before every per-family count, for the same reason
    # the exclusion sits where it does: rows the corpus will not contain must not be in
    # anyone's denominator. Not conditioned on `--sample`, unlike the origin-document
    # floor: that floor is a COUNT over the release quota and a smoke holds a fraction of
    # it by construction, while a contamination FRACTION is scale-free and a detected
    # artifact is one whether it was found in a smoke or a release.
    artifact_report = artifact_gate.measure(artifact_gate.generated_lines(records))
    for entry in artifact_report["families"]:
        if entry["contaminated"]:
            print(
                f"artefato: {entry['family']} "
                f"{entry['contaminated']}/{entry['lines']} "
                f"({entry['fraction'] * 100:.2f}%) — {entry['verdict']}"
            )
    # Published BEFORE the verdict, so the diagnosis survives the refusal. The probes that
    # matched are the actionable half of the gate's output — "this family echoes the
    # word-count directive" tells a lane owner what to change — and the refusal message
    # carries only the detection names and the counts. It is also written for a corpus that
    # PASSES: "no family is contaminated" is a measurement over named families with named
    # denominators, and only the artifact says which families were measured.
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "artifact-gate.json").write_text(
        json.dumps(artifact_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    artifact_gate.assert_no_lane_needs_regeneration(artifact_report)

    per_family = positive_rows_per_family(records)
    positives = {f: sum(c.values()) for f, c in per_family.items()}
    class_size = Counter(r["label"] for r in records)
    # The SAME arithmetic `assign_partitions` uses, so the two cannot disagree about how
    # much room the blind block has: test is the remainder after the four rounded blocks.
    # A second, independently written copy of this sum would let a family be declared
    # held-out with no room to hold it.
    test_capacity = {
        lab: n - sum(round(n * CLASS_FRACTIONS[b]) for b in CLASS_FRACTIONS)
        for lab, n in class_size.items()
    }

    reserved = {f for f, role in roles.items() if role == OOD_RESERVED_ROLE}
    print(f"papeis do slate: {dict(sorted(roles.items()))}")
    withdrawn: dict[str, str] = {}
    if not args.sample:
        # Release only, for the reason the origin-document floor is release only: a smoke
        # collects a fraction of the quota by construction, so every family of a smoke is
        # under a floor written for a sealed corpus.
        thin = reserved_families_below_the_recall_floor(positives, reserved)
        if thin:
            print(
                f"!! reserva magra (<{HELD_OUT_MINIMUM} positivos, validate exige) — as "
                f"linhas SAEM do corpus: {thin}"
            )
            for family, count in thin.items():
                withdrawn[family] = (
                    f"{count} positivos, abaixo do piso de {HELD_OUT_MINIMUM} que "
                    "validate exige por familia declarada"
                )
            records = [
                r
                for r in records
                if group_axes.identity_of(r["groups"].get("generatorFamily"))
                not in thin
            ]
            reserved -= set(thin)
            for family in thin:
                per_family.pop(family, None)
                positives.pop(family, None)
            class_size = Counter(r["label"] for r in records)
            test_capacity = {
                lab: n - sum(round(n * CLASS_FRACTIONS[b]) for b in CLASS_FRACTIONS)
                for lab, n in class_size.items()
            }
    assert_the_blind_block_holds_both_roles(
        reserved_rows_per_class(per_family, reserved), test_capacity
    )
    held_out = set(reserved)
    assign_partitions(records, held_out)
    # AFTER partitioning: generatedAt is part of the batch key, so batches can
    # only be derived once each record knows its temporal block.
    batches = assign_generation_batches(records)

    # Governance inputs for build_governance.ts. The two human sources are the ones the
    # frame draws on, and they are the ones `V3_HUMAN_SOURCE_INVENTORY` stocks: a
    # manifest listing `src_ptso` or `src_b2w` would declare a source the audit refuses
    # by name (SOURCE_BLOCKED_BY_ACCESS_TERMS / SOURCE_OUT_OF_DECLARED_FRAME), so the
    # rows would be blocked one step later with the manifest asserting them.
    #
    # The licence of each entry, and the whole inventory, are PROJECTED from the records:
    # the licence the documents declared is what the manifest states, so the manifest
    # cannot describe a corpus other than the one written next to it.
    source_types = {
        "src_wikipedia_pt": "licensed-corpus",
        "src_carolina": "licensed-corpus",
        "src_ai": "controlled-generation",
        "src_mixed": "controlled-generation",
    }
    licenses_by_source = source_licenses(records)
    governance = {
        # The live corpus identity, spelled once. `ptbr-generic-v1` is refused BY NAME by
        # `ingestAuthorizedRecords` (`dataset.refusedIds` in the pre-registration), so a
        # producer that still wrote it would build a corpus the importer cannot accept.
        "datasetId": "cleanfeed-ptbr-cells-v1",
        "sources": [
            {
                "sourceId": sid,
                "sourceType": source_types[sid],
                "licenseId": licenses_by_source[sid],
            }
            for sid in sorted(licenses_by_source)
        ],
        "heldOutGeneratorFamilies": declared_held_out_families(held_out, withdrawn),
        "generationBatches": batches,
        "licenses": used_license_inventory(records),
    }

    # A GUARDA DA TRIAGEM, sobre os registros que o corpus vai realmente conter: depois
    # dos drops de familia e do piso da reserva, porque "registro selecionado" e o que
    # sobra e nao o que foi construido. O SELO vem depois dela, nunca antes: `passed` e a
    # consequencia da disposicao ter sido conferida.
    if screen_ledger is not None:
        assert_the_screen_passed_every_selected_record(
            [(funnel_key_by_record[r["id"]], r) for r in records], screen_ledger
        )
        for record in records:
            stamp_the_screen_run(record)
        print(f"corrida {SCREEN_FILTER} estampada em {len(records)} registro(s)")

    # THE CLUSTER DISTRIBUTION REPORT (requirement 7). Counts, size distribution and
    # the largest cluster per axis AND per slice, over the records actually written.
    # It feeds E3's power gate, and it is what makes the old per-record token
    # impossible to reintroduce unnoticed: under `base_groups` every axis would read
    # `clusters == records`, `sizeDistribution == {"1": n}` and largest size 1 —
    # which is what this report would have said all along, had anyone asked it.
    report = group_axes.cluster_report(cluster_report_rows(records))

    out = args.out_dir
    (out / "private").mkdir(parents=True, exist_ok=True)
    (out / "cluster-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # The private evidence index every human row's labelEvidenceRef resolves against.
    # Deduplicated by entryId: it is one entry per REGISTRATION and not one per record, so
    # thousands of human rows point at a handful of entries.
    by_entry = {entry["entryId"]: entry for entry in evidence_entries}
    (out / "private" / "label-evidence.jsonl").write_text(
        "".join(
            json.dumps(entry, ensure_ascii=False) + "\n"
            for _, entry in sorted(by_entry.items())
        ),
        encoding="utf-8",
    )
    with (out / "records.jsonl").open("w", encoding="utf-8", newline="\n") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (out / "private" / "review-ledger.jsonl").open(
        "w", encoding="utf-8", newline="\n"
    ) as fh:
        for r in records:
            fh.write(
                json.dumps(
                    {
                        "recordId": r["id"],
                        # The LEDGER records the state, and for an unreviewed row
                        # that is all there is: no reviewer token and no verdict,
                        # because there was no reviewer and no review. It used to
                        # copy both out of the fabricated annotation block, which is
                        # how a hash over this file came to certify a review that
                        # never happened (integrity.review-ledger-hash).
                        "reviewState": r["review"]["state"],
                        "automatedFilters": [
                            f["filter"] for f in r["review"]["automatedFilters"]
                        ],
                        "humanAuditAbsentReason": r["review"][
                            "humanAuditAbsentReason"
                        ],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    (out / "governance-inputs.json").write_text(
        json.dumps(governance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # Report what was REALIZED, not the target: a pool short of its quota is the
    # difference between a sealed 10k corpus and a partial one.
    realized = Counter(r["label"] for r in records)
    parts = " ".join(f"{k} {realized[k]}/{counts[k]}" for k in ("human", "ai", "mixed"))
    print(f"records: {len(records)}/{sum(counts.values())} ({parts})")
    # PER CELL, because the aggregate human count hides the only shortfall that matters:
    # each cell's FPR ceiling is computed over that cell's own human negatives, so a cell
    # under the floor reproves the seal however large the total is.
    by_cell = Counter(r["humanSourceType"] for r in records if r["label"] == "human")
    print(
        f"humanas por celula (cota {counts['human'] // len(QUOTA_CELLS)}, piso da "
        f"politica {HUMAN_COLLECTION['perCellFloor']}): "
        + " ".join(f"{cell} {by_cell[cell]}" for cell in QUOTA_CELLS)
    )
    print(f"lotes de geracao declarados: {len(batches)}")
    short = {k: counts[k] - realized[k] for k in counts if realized[k] < counts[k]}
    if short:
        print("!! FALTAM (pool esgotado):", short)
    print("held-out families (reserva OOD do slate):", sorted(held_out))
    thin = thin_held_out_families(records, held_out)
    if thin:
        print(f"!! held-out families magras (<{HELD_OUT_MINIMUM}):", thin)
    print("hard-negatives:", dict(Counter(
        r.get("hardNegativeFamily") for r in records if r.get("hardNegativeFamily"))))
    print("--- distribuicao de clusters por eixo e por fatia ---")
    print(group_axes.render_cluster_report(report))
    print(f"entradas de evidencia de rotulo: {len(by_entry)}")
    print(f"escrito em {out}")


if __name__ == "__main__":
    main()


