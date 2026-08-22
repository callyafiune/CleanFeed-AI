"""Builds the MIXED class: AI-edited human parents with per-span provenance.

The sealed schema requires mixture = {aiFraction, humanFraction, spans:
[{start, end, origin}]} where spans TILE the final text and fractions sum to 1.
Spans are derived mechanically from a character diff (difflib) between the
HUMAN parent and the AI-EDITED result: equal blocks keep origin "human";
replaced/inserted blocks are origin "ai". No LLM self-reporting — the diff IS
the provenance.

Two modes:
  --from-pairs pares.jsonl   # {parentId, parentText, editedText} já prontos
  --generate                 # pede a edição a um provedor

`--generate` fala pela lane `gemini-api`, e ela deixou de ser caminho de geração por
decisão: material vem por HARNESS e não por API. Então este modo — o único que itera as
CÉLULAS e sabe dizer que operação a linha realizou — não tem hoje lane por onde falar. A
outra pista agy que existe (`make_mixed_agy.py`) faz edit genérico e pina `mix_edit_v1`,
sem noção de célula, então não substitui. Portar o laço para uma pista agy é a unidade que
a classe mista espera, e até lá `--generate` roda sob uma lane que a política não quer:
quem o executar gasta cota por linha que a decisão já recusou.

Sealed-corpus rule: parents MUST come from the reserved bucket (never trained).

`--island` is required in BOTH modes and judged at the parser, so refusal happens
BEFORE the provider is reached. The island the parser returns is then READ by the
`--generate` loop: it supplies the parents' seed block and the mixing identity of
each cell, so the row that gets written belongs to the island by construction.
The parser is also what holds the guard over a mode this file does not have yet:
`type=island_plan` runs before `main` dispatches on the mode at all.

The `--generate` loop iterates the CELLS of the island — `operation x level`, the
twenty that `assemble_corpus.mix_cells()` derives — and not just its parents. Each
cell fixes three things: which of the island's three mixing identities is stamped,
which geometry the prompt asks for, and which target `aiFraction` the level fills
in. A run that knew only the parents could not say which operation a row realised,
and stamping one anyway writes a claim the text does not support.

Usage (generation, resume-safe):
  python make_mixed.py --generate --island ilha_00 \
    --parents ../data/dataset/reserved.jsonl \
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


def canonical_text(text: str) -> str:
    """A cadeia CANONICA da pista mista, e e nesta forma que tudo a jusante a le.

    A normalizacao e a REPRESENTACAO da pista e nao um passo do escritor: ela corre antes do
    diff, da decisao de banda, do hash e do `emit`, e os tres leem a MESMA cadeia. Duas razoes
    medidas, e as duas doem:

    * os vaos de `compute_mixture` sao offsets sobre o texto editado e o fecho e `len(edited)`,
      entao normalizar DEPOIS do diff deixa o ultimo vao apontando fora da cadeia escrita — 77
      contra 73, medido. Dentro do lab ninguem reclama: `mixed_record` recomputa `aiFraction`
      sobre o denominador errado e o gate antiartefato fatia a cadeia errada. Quem recusa e a
      ingestao SELADA, do outro lado da fronteira — `corpus-import.ts` troca o texto por
      `normalizeCorpusText(text)` e so depois valida, e `schema.ts` levanta
      "mixture.spans[i] out of text bounds" —, o que faz do defeito uma recusa tardia e nao
      um silencio;
    * o pai chega NORMALIZADO (`CandidateWriter.offer`) e o editado chega cru, e a assimetria
      NFC corrompe o proprio diff: medido, editado em NFD contra pai em NFC da 6 vaos e
      `aiFraction` 0,5263 — nivel 50, DENTRO da banda — contra 2 vaos e 0,2037 com os dois lados
      canonizados. A linha declararia nivel 50 sobre um texto que e 20 % de IA.

    A regra e a do LAB (`common.normalize_text`) e nao a SELADA
    (`corpus-import.ts::normalizeCorpusText`, que faz so CRLF/CR -> LF e NFC). A escolha e
    deliberada e tem preco: o `text` guardado e texto CANONICO e nao a resposta verbatim do
    provedor. A alternativa foi medida e recusada — a selada preserva o espacamento que o
    provedor produz, entao a lane nasceria acima do teto de 2 % das sondas de espacamento em
    TODA corrida, e regenerar a lane reproduziria a brecha em vez de a fechar.

    Vale igualmente para `--from-pairs`, cujo `editedText` foi escrito por OUTRA pista:
    canonizar aqui reescreve o que ela escreveu, e isso e deliberado — duas linhas mistas que
    diferissem apenas em espaco descreveriam o mesmo texto sob dois digests.

    O QUE ISTO NAO ALCANCA, e o limite e operacional: a canonizacao e PROSPECTIVA. As linhas
    ja escritas nao sao migradas — `already_done` chaveia por `parentId` e `--output` abre em
    append —, e 235 das 2.135 mistas em disco estao na representacao antiga, medido. Enquanto
    elas estiverem la a pista tem DUAS representacoes, o dedup da montagem compara por
    igualdade exata e nao ve atraves das duas, e o remedio que
    `assert_no_lane_needs_regeneration` prescreve ("regenerate the lane") e NO-OP: reexecutar
    o comando importa apenas os pares ainda nao feitos. Fechar exige apagar
    `mixed_candidates.jsonl` e `mixed_from_pairs.jsonl` antes de reexecutar, e essa e a unica
    forma medida de a promessa acima valer para o corpus inteiro.

    Importado TARDE, no molde de `assembler()`: este arquivo roda como script, e um import de
    topo amarraria a cwd.
    """
    lab = str(Path(__file__).resolve().parent)
    if lab not in sys.path:
        sys.path.insert(0, lab)
    from common import normalize_text

    return normalize_text(text)


def mixed_bands() -> tuple[tuple[int, float, float], ...]:
    """A banda de cada nivel: (nivel, piso, teto), DERIVADA de `MIX_LEVELS`.

    A regra e uma so — do proprio nivel ao ponto MEDIO ate o nivel seguinte — e ela nao e uma
    tolerancia escolhida aqui: ela REPRODUZ a unica banda que a politica ratificou, a de v4,
    fechada por baixo em [0,50-0,55] (ESTADO § 3.3), porque `midpoint(50, 60)` e 55. Um teste
    nomeado afirma essa igualdade, e e o que impede a regra de virar outra coisa em silencio.
    O ultimo nivel fecha abaixo de 1,0: documento integralmente de IA nao tem origem dividida,
    e `mixture` e proibida fora de `mixed` por esse motivo.

    O piso e FECHADO e o teto ABERTO, o que faz as sete bandas particionarem sem lacuna e sem
    sobreposicao — e uma fracao abaixo do primeiro nivel nao cai em banda alguma. A banda
    unica de antes admitia de 0,05 a 0,70, isto e, admitia fracao que nivel nenhum reivindica
    e RECUSAVA v6 e v7, que a curva ratificada exige.
    """
    niveis = assembler().MIX_LEVELS
    bandas = []
    for indice, nivel in enumerate(niveis):
        seguinte = niveis[indice + 1] if indice + 1 < len(niveis) else None
        teto = (nivel + seguinte) / 200 if seguinte is not None else 1.0
        bandas.append((nivel, nivel / 100, teto))
    return tuple(bandas)


def mixed_level_of(mixture: dict) -> int | None:
    """O nivel de que esta fracao observada e, ou `None` se de nenhum.

    A coorte de uma linha e decidida pela fracao OBSERVADA e nunca pelo alvo da operacao: um
    v4 que aterrissa em 0,48 sai da coorte, e e essa a razao de a banda existir.
    """
    fracao = mixture["aiFraction"]
    for nivel, piso, teto in mixed_bands():
        if piso <= fracao < teto:
            return nivel
    return None


def in_mixed_band(mixture: dict) -> bool:
    """An edit that rewrote (quase) tudo não é "misto"; idem cópia fiel."""
    return mixed_level_of(mixture) is not None


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


# A GEOMETRIA de cada operacao de mistura, chaveada por ela, e o `{nivel}` e o alvo em
# pontos percentuais de `aiFraction`. A geometria e o que a operacao E: o que o pedido diz
# sobre ONDE o trecho de IA entra e QUANTO ocupa, e nada sobre o que ele diz.
#
# A geometria da insercao — uma secao contigua NO MEIO do pai, com o pai preservado inteiro
# — nao e uma escolha de redacao: e a geometria sobre a qual `MIX_CELL_EXCLUDED` foi medido
# com `shingles_of`/`jaccard`. Nela o par pai/mista cruza o limite de poda de 0,82 a partir
# de 218 tokens de pai, com o sinal monotono so a partir de 232; com o enxerto ANEXADO ao
# fim o par fica acima do limite em todo comprimento, e a razao "proxy de comprimento" que
# exclui `(insercao, 15)` deixa de valer. Duas assercoes de
# `test_a_celula_EXCLUIDA_e_alcancavel_SO_em_pai_curto_e_por_isso_sai` prendem o LUGAR e a
# preservacao integral do pai; o resto da redacao e livre.
MIX_GEOMETRIES: dict[str, str] = {
    "substituicao": (
        "Substitua UMA secao contigua do texto abaixo — uma sequencia de frases vizinhas, "
        "no meio do texto — por um trecho novo escrito com as suas palavras, de modo que o "
        "trecho novo ocupe aproximadamente {nivel} % do texto final. Copie todo o restante "
        "exatamente como esta, palavra por palavra, sem corrigir nem melhorar nada."
    ),
    "insercao": (
        "Acrescente UMA secao contigua nova no meio do texto abaixo, entre duas frases "
        "vizinhas, de modo que a secao nova ocupe aproximadamente {nivel} % do texto "
        "final. Copie o texto inteiro exatamente como esta, palavra por palavra, sem "
        "corrigir nem melhorar nada e sem remover nada."
    ),
    "concatenacao": (
        "Copie as primeiras frases do texto abaixo exatamente como estao, palavra por "
        "palavra, e escreva a seguir um corpo novo com as suas palavras que continue o "
        "assunto, de modo que o corpo novo ocupe aproximadamente {nivel} % do texto "
        "final. Descarte o resto do texto original."
    ),
}

# As quatro INTENCOES de edicao local: o que o trecho novo DIZ. Nenhuma toca a geometria do
# enxerto — nem onde entra nem quanto ocupa —, e e essa separacao que preserva a medicao de
# Jaccard que decidiu `MIX_CELL_EXCLUDED`.
#
# Lista PROPRIA e estatica, e nao as tarefas do slate de geracao: aquelas sao transformacoes
# de DOCUMENTO INTEIRO (resumir, parafrasear, escrever verbete), e pedir um enxerto "no
# genero de resumo" e categoria errada.
MIX_INTENTS: dict[str, str] = {
    "explicar": "O trecho novo explica um termo que o texto usa sem definir.",
    "exemplificar": (
        "O trecho novo da um exemplo concreto do que o texto afirma em abstrato."
    ),
    "contextualizar": "O trecho novo acrescenta o contexto que o texto pressupoe.",
    "qualificar": (
        "O trecho novo acrescenta a ressalva ou o limite do que o texto afirma."
    ),
}

# Os cinco REGISTROS do slate MISTO. As frases repetem as de `generate_ai`
# GENERATION_REGISTERS e isso e deliberado: importa-las faria o digest de uma identidade
# MISTA mover quando o slate de GERACAO mudasse, e uma linha ja persistida guardaria o
# digest antigo sob o mesmo id. Cinco frases duplicadas sao o preco de duas autoridades
# independentes. O efeito colateral e favoravel: como as sondas de eco de `artifact_gate`
# sao chaveadas pelo CHUNK, uma frase repetida vale UMA sonda e nao acrescenta superficie
# de eco contra o teto pre-inscrito de 2 %.
MIX_REGISTERS: dict[str, str] = {
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

# O fecho, identico nos sessenta: o provedor tem de devolver o texto COMPLETO resultante,
# porque a proveniencia sai do diff entre o pai e o resultado — uma resposta que traga so o
# trecho novo nao tem vaos que ladrilhem coisa alguma.
_MIX_CLOSING = "Responda apenas com o texto completo resultante, sem comentarios."

# Quantas ilhas o slate misto serve. ESPELHO de `assemble_corpus.ISLAND_COUNT`, no molde de
# `generate_ai._SLATE_ISLAND_COUNT` e pela mesma razao: ler o plano aqui obrigaria a importar
# `assemble_corpus` no topo, e este arquivo e importado por `make_mixed_agy.py` e
# `make_mixed_codex.py`, que passariam a arrastar `artifact_gate` -> `generate_ai` so para
# compor um prompt. A igualdade e pinada por teste contra os nomes que `_island()` declara em
# `mixingTemplates`.
_MIX_SLATE_ISLAND_COUNT = 20


class MixSlateArithmetic(RuntimeError):
    """A aritmetica congelada do slate misto nao fecha com o numero de ilhas."""


def _mix_pair(indice: int) -> tuple[str, str]:
    """A coordenada (intencao, registro) da ilha `indice`, congelada NESTE slate.

    Quatro intencoes por cinco registros dao vinte coordenadas distintas, uma por ilha, e a
    atribuicao e por divisao inteira: o grupo escolhe a intencao e o resto o registro. Ela
    nao e lida do slate de geracao, que atribui `(tarefa, registro)` por outra regra — as
    duas autoridades sao independentes de proposito.
    """
    intencoes = tuple(MIX_INTENTS)
    registros = tuple(MIX_REGISTERS)
    if _MIX_SLATE_ISLAND_COUNT != len(intencoes) * len(registros):
        raise MixSlateArithmetic(
            f"o slate misto serve {_MIX_SLATE_ISLAND_COUNT} ilhas e declara "
            f"{len(intencoes)} intencoes x {len(registros)} registros = "
            f"{len(intencoes) * len(registros)} coordenadas: com menos coordenadas que "
            "ilhas duas ilhas partilhariam o par (intencao, registro) e as identidades "
            "delas ficariam identicas em bytes. Cresca as listas ou emende o plano"
        )
    grupo, resto = divmod(indice, len(registros))
    return intencoes[grupo], registros[resto]


def _mix_template(operacao: str, intencao: str, registro: str) -> str:
    return (
        f"{MIX_GEOMETRIES[operacao]} {MIX_INTENTS[intencao]} {MIX_REGISTERS[registro]} "
        f"{_MIX_CLOSING}\n\n=== TEXTO ===\n{{parent}}"
    )


# As tres receitas que a pista serviu ANTES das sessenta, mantidas porque os pools em disco
# foram escritos sob elas: `--from-pairs` importa pares que declaram `mix_edit_v1`, e
# `--assume-template` e a afirmacao do operador sobre um arquivo antigo. Nenhuma delas
# declara operacao, e e assim que a guarda de `emit` distingue "edit generico" de "operacao
# do plano" por UMA igualdade.
#
# `PROMPT_CHANGE_LESS` e `PROMPT_CHANGE_MORE` deixaram de ser ENVIADAS por lane alguma: o
# nudge reexecuta o MESMO template no nivel adjacente, entao a correcao mora no parametro e
# nao numa identidade nova. Ficam aqui porque o digest delas e o que identifica as linhas
# que elas produziram.
_LEGACY_MIX_TEMPLATES: dict[str, str] = {
    "mix_edit_v1": EDIT_PROMPT,
    "mix_change_less_v1": PROMPT_CHANGE_LESS,
    "mix_change_more_v1": PROMPT_CHANGE_MORE,
}


def _build_mix_slate() -> dict[str, dict]:
    """O slate misto: as tres receitas antigas mais as sessenta identidades do plano.

    Sessenta DERIVADAS e nao sessenta literais, e as duas razoes sao as do slate de geracao:
    os nomes tem de ser exactamente os que `assemble_corpus._island()` declara em
    `mixingTemplates`, e uma segunda escrita deles divergiria sem nada reprovar; e compor de
    3 geometrias + 4 intencoes + 5 registros mantem os chunks de instrucao na ordem de
    grandeza de hoje, contra o teto de eco de 2 %.

    IDENTIDADE e o digest dos BYTES, entao sessenta nomes sobre corpos repetidos seriam uma
    particao NOMINAL: as tres coordenadas entram todas na composicao, e e por isso que
    `(operacao, intencao, registro)` distintos dao bytes distintos.

    `operation`, `intent` e `register` sao campos DECLARADOS porque quem decide le o campo e
    nunca o nome: `emit` confere a operacao da linha contra `operation`, e recuperar a
    operacao partindo `mix-substituicao-ilha-00` faria do nome um esquema.
    """
    slate: dict[str, dict] = {
        nome: {
            "template": corpo,
            "operation": None,
            "intent": None,
            "register": None,
        }
        for nome, corpo in _LEGACY_MIX_TEMPLATES.items()
    }
    for indice in range(_MIX_SLATE_ISLAND_COUNT):
        intencao, registro = _mix_pair(indice)
        for operacao in MIX_GEOMETRIES:
            slate[f"mix-{operacao}-ilha-{indice:02d}"] = {
                "template": _mix_template(operacao, intencao, registro),
                "operation": operacao,
                "intent": intencao,
                "register": registro,
            }
    return slate


# The mixing templates, each identified by the digest of its own bytes, so
# `groups.promptTemplate` groups mixed rows by the recipe that actually produced them.
#
# The pools already on disk record none of this, and it is NOT reconstructable from
# them: nothing in a written row says whether a nudge fired. So the assembler refuses
# those rows (MissingRecipe) instead of stamping them with whichever template this
# file holds today — see assemble_corpus.mixed_record.
MIX_TEMPLATES: dict[str, dict] = _build_mix_slate()

# As identidades que NAO declaram operacao, e sao as unicas que `--assume-template` admite:
# afirmar que um arquivo de pares antigo foi produzido por `mix-substituicao-ilha-00`
# atribuiria a ele pertenca de ilha e uma operacao que ninguem executou.
LEGACY_MIX_TEMPLATE_IDS: tuple[str, ...] = tuple(
    sorted(nome for nome, spec in MIX_TEMPLATES.items() if spec["operation"] is None)
)


def mix_template_digest(template_id: str) -> str:
    return hashlib.sha256(
        MIX_TEMPLATES[template_id]["template"].encode("utf-8")
    ).hexdigest()


def adjacent_mix_level(nivel: int, *, para_baixo: bool) -> int | None:
    """O nivel vizinho na curva, ou `None` quando o pedido esta na ponta dela.

    E o mecanismo do nudge depois de D7: a correcao mora no PARAMETRO e nao numa identidade
    nova — o mesmo template reexecutado no nivel adjacente —, porque a ilha reserva UM slot
    por operacao e trocar de template subcontaria as sessenta identidades.

    `None` e a resposta na ponta, e a consequencia e nao gastar chamada: reexecutar o mesmo
    pedido no mesmo nivel compraria uma amostra do mesmo sorteio ao preco de cota.
    """
    niveis = assembler().MIX_LEVELS
    posicao = niveis.index(nivel) + (-1 if para_baixo else 1)
    return niveis[posicao] if 0 <= posicao < len(niveis) else None


def assembler():
    """`assemble_corpus`, importado TARDE e com o diretorio do lab garantido no path.

    Este arquivo roda como script, e o montador arrasta `artifact_gate` ->
    `generate_ai` consigo. O import mora aqui, e nao no topo, porque o `type=` do
    argparse e o unico ponto deste arquivo que precisa do plano.
    """
    lab = str(Path(__file__).resolve().parent)
    if lab not in sys.path:
        sys.path.insert(0, lab)
    import assemble_corpus

    return assemble_corpus


def island_plan(value: str) -> dict:
    """`--island`'s type: a ilha cujo slate de MISTURA esta servido, ou a recusa.

    As quatro primeiras pernas sao as de `generate_ai.island_plan`, pelas MESMAS
    funcoes de producao e nao por numero comparado: o plano e uma particao, a
    geometria realiza as cinco fracoes, a reserva deixa lugar de nucleo no bloco
    cego, e `--island` nomeia uma ilha do plano. A QUINTA e o que esta pista troca:
    onde a lane de geracao confere `templates` contra `RECIPES`, esta confere os tres
    `mixingTemplates` da ilha contra `MIX_TEMPLATES`, que e o slate de mistura que o
    plano pede desta pista. A perna da geracao nao serve aqui: `RECIPES` escreve o
    eixo nas linhas `ai`.

    A SEXTA perna e a que impede a forma de fraude que esta pista abriu ao crescer: o
    slate serve sessenta nomes, e sessenta nomes sobre corpos de bytes REPETIDOS
    satisfariam a quinta perna e mentiriam — identidade E o digest dos bytes, entao a
    particao de ilha ficaria NOMINAL e o recall voltaria a ser medido sobre prompts ja
    vistos. Ela e a mesma de `generate_ai.island_plan` e morde no mesmo lugar, antes
    de qualquer chamada de provedor.

    A ilha devolvida E lida por `main`: o laco de geracao tira dela a identidade de
    template de cada celula. Foi por isso que a quinta perna deixou de ser suficiente
    sozinha — enquanto a ilha nao alcancava o escritor, um slate servido deixava esta
    pista escrever linha mista cuja identidade nao pertencia a ilha alguma.
    """
    lab = assembler()
    try:
        lab.assert_island_plan_is_a_partition(lab.ISLAND_PLAN)
        lab.assert_island_plan_realizes_the_five_fractions(lab.ISLAND_PLAN)
        lab.assert_island_plan_leaves_core_in_the_blind_block(lab.ISLAND_PLAN)
        island = lab.island_named(lab.ISLAND_PLAN, value)
    except lab.IslandPlanRefused as refused:
        raise argparse.ArgumentTypeError(str(refused)) from None
    pedidos = tuple(
        island["mixingTemplates"][operacao]
        for operacao in sorted(island["mixingTemplates"])
    )
    faltando = tuple(nome for nome in pedidos if nome not in MIX_TEMPLATES)
    if faltando:
        raise argparse.ArgumentTypeError(
            f"a ilha {value!r} pede os templates de mistura {pedidos} e este "
            f"arquivo serve {tuple(sorted(MIX_TEMPLATES))}: os que faltam sao "
            f"{faltando}. Cresca `MIX_TEMPLATES` ate cobrir o plano, ou emende o "
            "plano — misturar sob um slate que o plano nao cumpre produz linha mista "
            "cuja identidade de template nao pertence a ilha alguma, e a montagem a "
            "recusa depois de a cota estar gasta"
        )
    por_digesto: dict[str, list[str]] = {}
    for nome in sorted(MIX_TEMPLATES):
        por_digesto.setdefault(mix_template_digest(nome), []).append(nome)
    repetidos = {
        digesto[:16]: nomes for digesto, nomes in por_digesto.items() if len(nomes) > 1
    }
    if repetidos:
        raise argparse.ArgumentTypeError(
            f"o slate de mistura serve receitas de bytes identicos: {repetidos}. A "
            "particao de ilha ficaria NOMINAL — identidades distintas sobre o mesmo "
            "prompt —, e o recall voltaria a ser medido sobre prompts ja vistos, que e "
            "o que a obrigacao de ilha existe para impedir"
        )
    return island


# The keys a parent row contributes to a mixed pair, in ONE place because there are
# two callers reading two different files: the reserved pool (`id`/`text`) and a pairs
# file written by another lane (`parentId`/`parentText`).
PARENT_PROJECTION_KEYS = ("id", "text", "family", "sourceMaterialBatch")


def parents_per_island(parents: list[dict]) -> dict[str, int]:
    """ilha -> quantos pais admissiveis o plano lhe da, sobre uma lista JA filtrada.

    Sobre a lista filtrada e nao sobre o arquivo cru, porque o que interessa e o que
    sobrevive as duas telas que a pista aplica antes de gastar chamada: `label == 0` e a
    janela de palavras. Um total global que ignore a ilha esconde o caso que importa —
    excedente numa ilha nao preenche a cota de outra, porque cada ilha toma so o proprio
    bloco de semente.
    """
    lab = assembler()
    contagem: dict[str, int] = {}
    for pai in parents:
        ilha = lab.island_of_seed(lab.ISLAND_PLAN, pai["id"])["island"]
        contagem[ilha] = contagem.get(ilha, 0) + 1
    return contagem


def islands_short_of_the_mixed_quota(parents: list[dict]) -> dict[str, tuple[int, int]]:
    """ilha -> (pais admissiveis, cota mista) para as ilhas que NAO fecham a cota.

    O rendimento da banda vem DEPOIS disto e so pode piorar: uma ilha com menos pais que a
    cota nao fecha nem com rendimento de 100 %, e por isso a conta e feita antes de a
    corrida gastar a primeira chamada. `--generate` a imprime, e a decisao de que fazer
    com o deficit — mais pais, outra janela, ou celula sub-preenchida aceita — nao e desta
    funcao.
    """
    lab = assembler()
    contagem = parents_per_island(parents)
    curtas: dict[str, tuple[int, int]] = {}
    for ilha in lab.ISLAND_PLAN:
        cota = ilha["lines"]["mixed"]
        tem = contagem.get(ilha["island"], 0)
        if tem < cota:
            curtas[ilha["island"]] = (tem, cota)
    return curtas


def parent_projection(
    row: dict, *, id_key: str = "id", text_key: str = "text"
) -> dict:
    """The parent fields a mixed record needs, projected from the row that holds them.

    `sourceMaterialBatch` belongs HERE and not further downstream: a mechanistic mixed
    row is the parent's text with generated stretches, so the material it depends on is
    the PARENT's acquisition event, and `AXIS_STATE_RULE.sourceMaterialBatch` admits
    only `known` on that class. A projection that drops the key makes every mixed row
    unwritable and does it QUIETLY — the assembler counts the drop and keeps going.

    `None` is the truthful value for a parent that names no acquisition (the reserved
    pool predates the extractors that emit one). The row is then dropped at assembly
    rather than filed under an invented batch.
    """
    return {
        "id": row[id_key],
        "text": row[text_key],
        "family": row.get("family", "?"),
        "sourceMaterialBatch": row.get("sourceMaterialBatch"),
    }


def emit(
    output,
    parent_row,
    edited: str,
    provider: str,
    model: str,
    # REQUIRED, with no default, and that is the last residual of commit b977b19
    # ("make a legacy pair's template an operator assertion, not a silent default").
    # `mix_edit_v1` used to sit here as a default. Both production call sites already
    # pass the value explicitly — one from the pair's own `promptTemplateId` or
    # `--assume-template`, one from the generating run — so the default was
    # unreachable today and reachable by the NEXT caller, who would inherit a recipe
    # claim without typing one. A mixed row is a controlled generation, so v3 requires
    # its recipe on the row; a caller that does not know which template ran must fail
    # here rather than publish `mix_edit_v1` and its digest as an observation.
    template_id: str,
    # REQUIRED os dois, e sem valor por omissao. Eles sao a metade da identidade que a
    # identidade de template nao carrega: o nome `mix-substituicao-ilha-00` diz de que slot
    # a linha saiu, e estes dois dizem o que a corrida PEDIU. Um valor por omissao aqui
    # deixaria um chamador novo herdar a alegacao de uma operacao que ele nao executou, que
    # e exactamente o dano que a porta pre-cota existe para nao abrir.
    mix_operation: str | None,
    mix_level: int | None,
    harness_version: str | None = None,
) -> None:
    # A operacao afirmada contra a que a IDENTIDADE declara, por UMA igualdade: ela recusa
    # as quatro direcoes de uma vez — identidade de ilha sem operacao, identidade de ilha
    # com a operacao de outro slot, receita legada com operacao, e a grafia alienigena. Sem
    # ela a porta pre-cota abriria com o escritor livre de estampar `mix-substituicao-ilha-00`
    # numa linha que fez outra coisa, e a alegacao falsa ficaria GRAVADA no corpus.
    declarada = MIX_TEMPLATES[template_id]["operation"]
    if mix_operation != declarada:
        raise ValueError(
            f"a linha afirma a operacao {mix_operation!r} e a identidade "
            f"{template_id!r} declara {declarada!r}: a identidade e o digest dos bytes de "
            "um prompt, e esse prompt pede uma geometria so. Estampar outra operacao aqui "
            "grava no corpus uma alegacao que o texto nao sustenta"
        )
    # E o nivel: presente exactamente quando ha operacao, e membro da curva. Uma receita
    # legada nao pediu nivel nenhum, e um nivel fora de `MIX_LEVELS` nomeia uma celula que
    # o plano nao compra.
    niveis = assembler().MIX_LEVELS
    if (mix_level is not None) != (declarada is not None) or (
        mix_level is not None and mix_level not in niveis
    ):
        raise ValueError(
            f"a linha afirma o nivel {mix_level!r} sob a identidade {template_id!r}, que "
            f"declara a operacao {declarada!r}: o nivel e o alvo da operacao, entao ele "
            f"existe exactamente quando a operacao existe e vem de {niveis}"
        )
    # A invariante de `emit`, conferida nele e nao prometida pelos chamadores: as duas
    # cadeias que entram aqui JA sao canonicas. Ela morava so nos dois sitios de `main`, e
    # um chamador novo — ou um teste — podia escrever cru sem que nada acusasse; a
    # canonizacao e idempotente, entao esta conferencia e exacta e nao aproximada. Levanta em
    # vez de canonizar aqui de proposito: canonizar seria um SEGUNDO sitio de decisao, e o
    # veredito de banda que corre antes de `emit` leria outra cadeia que a escrita.
    for papel, cadeia in (("parent_row['text']", parent_row["text"]), ("edited", edited)):
        if cadeia != canonical_text(cadeia):
            raise ValueError(
                f"{papel} chegou a `emit` fora da forma canonica da pista: a banda foi "
                "decidida sobre outra cadeia que a escrita, e os vaos indexariam um texto "
                "que ninguem gravou. Canonize na entrada (`canonical_text`), nao aqui"
            )
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
        # A celula que a corrida pediu, e o nivel e o ALVO da operacao e nunca a fracao
        # obtida — chavear a curva pela fracao daria uma chave por linha. A coorte de uma
        # linha continua a ser decidida pela fracao OBSERVADA (`mixed_level_of`), entao um
        # pedido de nivel 50 que aterrissa em 0,48 fica gravado como 50 e conta na coorte de
        # 40: os dois numeros respondem perguntas diferentes e nenhum substitui o outro.
        #
        # Ficam no TOPO da linha e nao dentro de `mixture` porque `MIXTURE_KEYS`
        # (`benchmark/schema.ts`) e vocabulario FECHADO do corpus selado: acrescentar chave
        # la recusaria toda linha na ingestao. O eixo de operacao de PRIMEIRA CLASSE segue
        # divida da v2 — mover `MIXTURE_KEYS` ou `V4_GROUP_AXES` move o `evaluatorDigest`.
        "mixOperation": mix_operation,
        "mixLevel": mix_level,
        # The editor binary's version on the CLI lanes, so the mixed rows can be
        # eligible for the same reason the generated ones can. None when the lane is
        # an API call or the capture failed — never a placeholder.
        "harnessVersion": harness_version,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "parentFamily": parent_row.get("family", "?"),
        # A mixed row IS the parent's text with generated stretches, so the material it
        # depends on is the PARENT's acquisition event. It travels on the pair row
        # because the parent id alone does not resolve one at assembly time, and the
        # axis admits only `known` on a mechanistic mixed row: a pair whose parent
        # carries no batch produces a row the assembler drops rather than one filed
        # under an invented acquisition.
        "sourceMaterialBatch": parent_row.get("sourceMaterialBatch"),
    }
    output.write(json.dumps(record, ensure_ascii=False) + "\n")
    # Cada registro custou cota real — nada pode viver só no buffer.
    output.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    # REQUIRED nos DOIS modos, e o `type=` e onde o plano e julgado. Ligar a
    # exigencia ao `--generate` deixaria de fora todo modo acrescentado depois — e o
    # `--from-pairs` importa linhas que carregam `promptTemplate` do mesmo jeito, so
    # que a cota delas foi gasta por outro arquivo.
    parser.add_argument(
        "--island",
        required=True,
        type=island_plan,
        metavar="{"
        + ",".join(ilha["island"] for ilha in assembler().ISLAND_PLAN[:2])
        + ",...}",
    )
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
        # SO as receitas sem operacao declarada. As sessenta identidades do plano estao
        # fora de proposito: um arquivo de pares antigo fez um edit generico, e afirmar
        # que ele saiu de `mix-substituicao-ilha-00` lhe atribuiria pertenca de ilha e
        # uma geometria que ninguem pediu.
        choices=LEGACY_MIX_TEMPLATE_IDS,
        help="afirma qual template produziu um arquivo de pares ANTIGO, que não grava "
        "o campo. Só é verdadeiro para lanes de um único prompt sem nudge retry "
        "(make_mixed_agy.py, make_mixed_codex.py hoje) — sem isto a importação de um "
        "par sem template FALHA em vez de supor",
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
                pai = canonical_text(pair["parentText"])
                editado = canonical_text(pair["editedText"])
                mixture = compute_mixture(pai, editado)
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
                        **parent_projection(
                            pair, id_key="parentId", text_key="parentText"
                        ),
                        "text": pai,
                    },
                    editado,
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
                    # O que o ARQUIVO declara, e `None` quando ele nao declara nada. Um
                    # arquivo escrito por outra pista sabe a sua operacao apenas se a
                    # gravou; supor uma aqui seria inventar a geometria de um texto que
                    # este processo nao pediu. A ausencia e a verdade, e `emit` recusa a
                    # combinacao incoerente com a identidade declarada.
                    mix_operation=pair.get("mixOperation"),
                    mix_level=pair.get("mixLevel"),
                    # ONLY what the pair file recorded, and no operator override. A
                    # `--assume-harness` flag lived here and was removed: requirement
                    # 6 of the C2 brief says outright that a version which cannot be
                    # obtained leaves the record INELIGIBLE, and never an "unknown"
                    # filled in by hand. The asymmetry with `--assume-template` above
                    # is deliberate and not an oversight. A template assertion is
                    # CHECKABLE from code that still exists — make_mixed_agy.py and
                    # make_mixed_codex.py each send one template with no corrective
                    # retry — while the version of a binary that ran months ago is
                    # recoverable from nothing: not from the pairs file, not from the
                    # scripts, not from the machine. Typing it would be inventing a
                    # version string, and it would buy the row back its eligibility,
                    # which is precisely the trade R6 forbids.
                    harness_version=pair.get("harnessVersion"),
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
            parent_projection(r)
            for r in read_jsonl(args.parents)
            if r.get("label") == 0 and 50 <= len(r["text"].split()) <= 450
        ]
        # E do BLOCO DE SEMENTES DESTA ILHA, imposto e nao prometido, no molde de
        # `generate_ai.select_humans`. Uma linha mista nomeia o pai em `derivationRoot` e
        # `humanSeed`, e `connected_components` une POR VALOR: um pai de outra ilha funde as
        # duas — medido, 2 componentes viram 1 — e o particionamento de template fica
        # decorativo depois de a cota estar gasta. O arquivo de pais e do corpus inteiro, e
        # a ilha toma a fatia que o plano lhe da.
        lab = assembler()
        # O plano INTEIRO e conferido sobre a lista ANTES do filtro de ilha, e essa e a
        # ordem que importa: um relatorio do plano lido da fatia de uma ilha imprime as
        # outras dezenove como 0 pais, que e falso e mais barato de acreditar do que de
        # conferir.
        curtas_do_plano = islands_short_of_the_mixed_quota(parents)
        parents = [
            pai
            for pai in parents
            if lab.island_of_seed(lab.ISLAND_PLAN, pai["id"])["island"]
            == args.island["island"]
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

        # A CELULA de cada pai, atribuida pela posicao dele na ordem intercalada da ilha
        # INTEIRA — nao na ordem da corrida. A diferenca importa no resume: `done` conta as
        # linhas de todas as ilhas no mesmo `--output`, entao indexar a alocacao pela corrida
        # daria celula diferente ao mesmo pai a cada retomada, e a linha declararia um nivel
        # que o pedido anterior nao pediu.
        #
        # A alocacao tem exactamente a cota mista da ilha, logo ela e tambem o teto de pais
        # que a corrida pode tomar: `20 celulas x 5 linhas` e o que a ilha compra, e um pai
        # sem celula seria uma linha fora do plano.
        ordenados = interleave_by_family(parents)
        alocacao = lab.mix_cell_allocation(args.island["lines"]["mixed"])
        celula_de = {
            pai["id"]: alocacao[posicao]
            for posicao, pai in enumerate(ordenados[: len(alocacao)])
        }
        pending = [
            p for p in ordenados if p["id"] in celula_de and p["id"] not in done
        ][: args.target]
        print(
            f"gerando {len(pending)} mistos em {args.island['island']} "
            f"(celulas={len(set(alocacao))}); ja no --output, de todas as ilhas: {len(done)}"
        )
        # A corrida imprime o deficit antes de gastar a primeira chamada, e o rendimento da
        # banda so pode piorar o numero impresso. Excedente numa ilha nao preenche a cota de outra, porque
        # cada ilha toma so o proprio bloco de semente — entao um total global de pais diz
        # menos do que parece. Aviso e nao recusa: o remedio (mais pais, outra janela, ou
        # celula sub-preenchida aceita) e escolha de quem coleta, e recusar aqui pararia
        # uma corrida que ainda produz as linhas que a ilha CONSEGUE.
        curtas = curtas_do_plano
        desta = curtas.get(args.island["island"])
        if desta is not None:
            tem, cota = desta
            print(
                f"!! {args.island['island']} tem {tem} pais admissiveis para uma cota de "
                f"{cota}: ela nao fecha nem com rendimento de banda 100 %, e a banda vem "
                f"depois. Deficit desta ilha: {cota - tem}"
            )
        if curtas:
            print(
                "   ilhas curtas no plano inteiro: "
                + ", ".join(
                    f"{ilha} {tem}/{cota}" for ilha, (tem, cota) in sorted(curtas.items())
                )
            )
        kept = 0
        for index, parent in enumerate(pending, start=1):
            operacao, nivel_da_celula = celula_de[parent["id"]]
            # A identidade sai da ILHA e da OPERACAO, e nao de um nome fixo: e o slot que a
            # ilha reserva para esta operacao. Sem isto o escritor estamparia uma receita
            # que nao pertence a ilha alguma, e a montagem recusaria a linha depois de a
            # cota estar gasta.
            template_id = args.island["mixingTemplates"][operacao]
            # Reset PER PARENT, not once outside the loop: um nudge numa linha nao pode
            # deixar a seguinte declarando o nivel vizinho que ela nunca pediu.
            nivel = nivel_da_celula
            template = MIX_TEMPLATES[template_id]["template"]
            pai = canonical_text(parent["text"])
            try:
                # O prompt sai da cadeia CANONICA, e nao da crua: o corte em 6.000
                # caracteres depende do espacamento, entao com pai cru o material enviado e
                # o material comparado podiam divergir na truncagem. Hoje o pool reservado
                # chega canonico (medido, 0 de 2.247 fora da forma), logo isto nao muda o
                # que se envia — e e o que impede a premissa de virar acidente.
                result = edit_with_failover(
                    template.format(parent=pai[:6000], nivel=nivel)
                )
                if result is not None:
                    result = (canonical_text(result[0]), result[1])
                mixture = compute_mixture(pai, result[0]) if result else None
                for _ in range(args.nudge_retries):
                    if result is None or in_band(mixture):
                        break
                    # O nudge reexecuta o MESMO template no nivel VIZINHO: a correcao mora
                    # no PARAMETRO, porque a ilha reserva UM slot por operacao e trocar de
                    # identidade aqui subcontaria as sessenta. O nivel nao entra no digest,
                    # entao o cluster de `promptTemplate` continua sendo um por operacao.
                    #
                    # A direcao compensa o desvio observado: texto que virou IA inteira pede
                    # o nivel de BAIXO, e texto quase intocado pede o de cima. Na ponta da
                    # curva nao ha vizinho, e ai a corrida NAO gasta chamada — repetir o
                    # mesmo pedido compraria outra amostra do mesmo sorteio ao preco de cota.
                    vizinho = adjacent_mix_level(
                        nivel,
                        para_baixo=mixture["aiFraction"] >= mixed_bands()[-1][2],
                    )
                    if vizinho is None:
                        break
                    nivel = vizinho
                    result = edit_with_failover(
                        template.format(parent=pai[:6000], nivel=nivel)
                    )
                    if result is not None:
                        result = (canonical_text(result[0]), result[1])
                        mixture = compute_mixture(pai, result[0])
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
                {**parent, "text": pai},
                edited,
                provider="gemini",
                model=used_model,
                template_id=template_id,
                mix_operation=operacao,
                # O nivel do pedido que SOBREVIVEU, e nao o da celula: quando o nudge corre,
                # o texto escrito veio do vizinho, e gravar o alvo da celula alegaria um
                # pedido que nao produziu este texto. A perda contra o plano aparece como
                # celula sub-preenchida, que e fato mensuravel; a alegacao errada, nao.
                mix_level=nivel,
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
