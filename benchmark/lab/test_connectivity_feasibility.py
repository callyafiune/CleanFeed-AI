"""A GUARDA DE ESTADO da conectividade v4 (run: python -m unittest).

Estes testes nao inventam regra: importam `connected_components`, `SPLIT_GROUP_KEYS` e
`group_axes` do proprio laboratorio e montam linhas com os mesmos eixos que
`assemble_corpus` escreve.

O que eles fixam e a viabilidade do split sob as chaves v4. `GROUP_KEYS` une registros por
VALOR compartilhado, o splitter poe o componente conexo INTEIRO numa unica particao e compara
fracao POR CLASSE. Dai saem duas condicoes NECESSARIAS, que valem em TODO escopo — o corpo
agregado e cada classe —, e vale escrever as duas porque a primeira e a frouxa:

* todo componente cabe em alguma particao — o maior nao pode exceder o maior alvo mais a
  tolerancia;
* toda particao pode ser preenchida — e esta e a afiada. Todo subconjunto nao vazio inclui ao
  menos um componente que carrega o escopo, entao realizar o MENOR alvo exige um componente que
  caiba nele. Logo o que limita e a MENOR contribuicao nao nula, nao a maior.

Nenhuma das duas e suficiente: a atribuicao completa e soma de subconjuntos, e o preflight
declara que nao a decide.

O INVENTARIO QUE EXISTE e um lote de aquisicao por fonte, e a moldura declara UMA fonte
estocada: um download do dump da Wikipedia. Um fixture com um lote por dominio descreveria
material que ninguem tem, e usa-lo para provar viabilidade seria provar sobre um corpus
imaginario — e por isso as celulas do fixture sao DERIVADAS do register do montador, nao
retypadas. As duas direcoes abaixo rodam sobre o MESMO corpo de lote-unico-por-celula: com as
chaves v4 ele e viavel, e devolver `domainSource` OU `sourceMaterialBatch` a uniao o torna
inviavel. Com uma celula as duas direcoes colapsam no MESMO componente — um estrato, uma
aquisicao —, e e essa coincidencia que faz o corpo inteiro virar um bloco indivisivel.
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import assemble_corpus  # noqa: E402
import group_axes  # noqa: E402
from assemble_corpus import (  # noqa: E402
    CLASS_FRACTIONS,
    FIVE_TARGETS,
    SPLIT_GROUP_KEYS,
    SPLIT_PARENT_LINKAGE_AXES,
    UnsplittableCorpus,
    assert_components_can_fill_five_partitions,
    assert_stamped_corpus_is_splittable,
    connected_components,
)

BENCHMARK = Path(__file__).resolve().parent.parent


def eixos_de_identidade_de_material() -> tuple[str, ...]:
    """`EXPOSURE_IDENTITY_AXES`, LIDO de benchmark/cluster-exposure-ledger.ts.

    O criterio da lista de uniao nomeia essa lista, e um espelho retypado aqui deixaria as
    duas divergirem em silencio: o ledger passaria a comparar um eixo de material que o
    splitter nao une, e este teste continuaria verde sobre a copia antiga.
    """
    fonte = (BENCHMARK / "cluster-exposure-ledger.ts").read_text(encoding="utf-8")
    marcador = "export const EXPOSURE_IDENTITY_AXES: readonly GroupAxis[] = ["
    if marcador not in fonte:
        raise RuntimeError(
            "cluster-exposure-ledger.ts nao expoe EXPOSURE_IDENTITY_AXES: o espelho nao "
            "pode adivinhar a autoridade"
        )
    corpo = fonte.split(marcador, 1)[1].split("]", 1)[0]
    eixos = tuple(re.findall(r'"([a-zA-Z]+)"', corpo))
    if not eixos:
        raise RuntimeError(
            "EXPOSURE_IDENTITY_AXES foi parseado vazio: o laco do criterio ficaria verde "
            "sem afirmar nada"
        )
    return eixos


def _lista_do_split_ts(nome: str) -> tuple[str, ...]:
    """Uma lista de admissao, LIDA de benchmark/split.ts em vez de retypada aqui.

    `INERT_UNION_AXES` e `IMPOSED_UNION_AXES` sao as duas pernas nao materiais do criterio,
    e este lado tem de classificar pelas listas que a PRODUCAO publica: uma copia deixaria a
    classificacao verde sobre uma lista que o splitter nao usa mais.
    """
    fonte = (BENCHMARK / "split.ts").read_text(encoding="utf-8")
    marcador = f"export const {nome} = ["
    if marcador not in fonte:
        raise RuntimeError(
            f"split.ts nao expoe {nome}: o espelho nao pode adivinhar a autoridade"
        )
    corpo = fonte.split(marcador, 1)[1].split("]", 1)[0]
    eixos = tuple(re.findall(r'"([a-zA-Z]+)"', corpo))
    if not eixos:
        raise RuntimeError(
            f"{nome} foi parseado vazio: o laco do criterio ficaria verde sem afirmar nada"
        )
    return eixos


# A menor particao do desenho de cinco (45/5/10/20/20).
MENOR_PARTICAO = 0.05

# O lote de AQUISICAO de cada fonte humana estocada: um download por fonte, que e o
# inventario que existe. Nao ha lote por dominio, e e por isso que devolver o lote a uniao
# funde celulas em vez de as separar.
LOTE_POR_FONTE = {
    "src_wikipedia_pt": "smb_ptwiki_20220301",
}

# As celulas da moldura e o lote de cada uma, DERIVADAS do register do montador em vez de
# retypadas. Uma lista a parte aqui e exatamente o erro que o docstring acima declara nao
# cometer: ela sobrevive a uma emenda da moldura, e o fixture passa a provar viabilidade
# sobre celulas que nenhuma autoridade declara.
CELULAS: tuple[tuple[str, str], ...] = tuple(
    (chave, LOTE_POR_FONTE[assemble_corpus.HUMAN_SOURCE[chave]])
    for chave in sorted(assemble_corpus.REGISTER)
)

# Quarenta linhas no CORPO, e nao por celula. Com uma celula, dez linhas dariam componentes
# de 10 % cada, e 10 % nao cabe na particao de 5 %: o fixture VIAVEL recusaria por tamanho de
# corpo em vez de medir granularidade, que e a coisa errada de medir aqui.
LINHAS_NO_CORPO = 40
LINHAS_POR_CELULA = LINHAS_NO_CORPO // len(CELULAS)


def linha(rec_id: str, dominio: str, autor: str, lote: str) -> dict:
    """Uma linha humana v4 extraida, com os eixos que o montador preenche.

    `source` e o DOCUMENTO de origem — o prefixo `th_` do corpo real e de thread —, um por
    registro. Dar a mesma `source` a varias linhas as uniria por outro eixo e mediria a coisa
    errada; foi o erro que a primeira versao desta medicao cometeu.

    `generationBatch` e `notApplicable`: numa linha humana nenhuma receita nossa rodou, e a
    tabela de estados do esquema so admite esse estado aqui. Ele esta escrito porque E um eixo
    de uniao em v4 — omiti-lo deixaria o fixture calado sobre o unico eixo de lote que une.
    """
    return {
        "id": rec_id,
        "schemaVersion": 4,
        "label": "human",
        "groups": {
            "author": group_axes.known(autor),
            "source": group_axes.known(f"th_doc_{rec_id}"),
            "domainSource": group_axes.known(group_axes.axis_token(dominio)),
            "sourceMaterialBatch": group_axes.known(group_axes.axis_token(lote)),
            "generationBatch": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "extractionRun": group_axes.known(f"er_{group_axes.axis_token(dominio)}"),
            "nearDuplicate": group_axes.known(f"nd_{rec_id}"),
            "derivationRoot": group_axes.not_applicable("texto extraido"),
        },
    }


def linha_gerada(
    rec_id: str,
    semente: str,
    estrato: str,
    template: str | None = None,
    versao: str | None = None,
) -> dict:
    """Uma linha GERADA v4, com os eixos que o montador preenche numa lane de geração.

    `humanSeed` nomeia o id de uma linha humana: e o eixo de LINHAGEM DE PAI, e ele une SOMENTE
    quando a linha nomeada esta no mesmo conjunto de registros. E assim que uma linha gerada
    fica no componente do material de que foi semeada; nomeando id ausente, ela fica sozinha.

    `sourceMaterialBatch` e `notApplicable` porque geracao nao adquire material — a tabela de
    estados do esquema so admite esse estado aqui — e `generationBatch` e proprio de cada
    linha, senao duas geradas se uniriam por eixo de valor e o componente deixaria de ser o
    declarado.

    `promptTemplate` e `generatorVersion` sao proprios da linha por omissao e COMPARTILHADOS
    quando o chamador os passa. Os dois ESTAO em `SPLIT_GROUP_KEYS`, entao compartilhar
    identidade UNE: e por isso que um chamador que quer grao fino tem de omiti-los, e e assim
    que o caso do catalogo descreve, com a mesma declaracao, a forma que os pools produzem (um
    componente de 100 %) e a geometria de ilhas que a Fase 3 item 2 tem de produzir.
    """
    return {
        "id": rec_id,
        "schemaVersion": 4,
        "label": "ai",
        "groups": {
            "author": group_axes.not_applicable(group_axes.NO_HUMAN_AUTHOR),
            "source": group_axes.not_applicable("texto gerado"),
            "domainSource": group_axes.known(group_axes.axis_token(estrato)),
            "humanSeed": group_axes.known(semente),
            "promptTemplate": group_axes.known(template or f"pt_{rec_id}"),
            "generatorVersion": group_axes.known(versao or f"gv_{rec_id}"),
            "sourceMaterialBatch": group_axes.not_applicable(
                group_axes.NO_MATERIAL_ACQUIRED
            ),
            "generationBatch": group_axes.known(f"gb_{rec_id}"),
            "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
            "nearDuplicate": group_axes.known(f"nd_{rec_id}"),
            "derivationRoot": group_axes.not_applicable(group_axes.NO_DERIVATION),
        },
    }


def linha_mista(rec_id: str, pai: str, dominio: str, autor: str, lote: str) -> dict:
    """Uma linha MISTA v4: o texto do pai com trechos gerados.

    Ela COMPARTILHA o autor do pai e o nomeia nos DOIS eixos de linhagem, porque nao e
    unidade de amostragem nova — e o que faz pai e mistas serem um componente so, e nao um
    por linha. O documento de origem, a quase-duplicata, o template e o lote de GERACAO sao
    proprios dela; o lote de MATERIAL e o estrato sao os do pai, porque a aquisicao que a
    sustenta e a dele, e e por isso que ela nao acrescenta estrato nem lote ao censo.

    `extractionRun` e `notApplicable`: o texto misto nao saiu de uma corrida de extracao
    nossa, e a tabela de estados do esquema so admite esse estado aqui.
    """
    return {
        "id": rec_id,
        "schemaVersion": 4,
        "label": "mixed",
        "groups": {
            "author": group_axes.known(autor),
            "source": group_axes.known(f"th_doc_{rec_id}"),
            "domainSource": group_axes.known(group_axes.axis_token(dominio)),
            "sourceMaterialBatch": group_axes.known(group_axes.axis_token(lote)),
            "humanSeed": group_axes.known(pai),
            "promptTemplate": group_axes.known(f"pt_{rec_id}"),
            "generatorVersion": group_axes.known(f"gv_{rec_id}"),
            "generationBatch": group_axes.known(f"gb_{rec_id}"),
            "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
            "nearDuplicate": group_axes.known(f"nd_{rec_id}"),
            "derivationRoot": group_axes.known(pai),
        },
    }


def corpo_de_lote_unico() -> list[dict]:
    """As celulas da moldura, um evento de aquisicao por fonte, cada linha em seu documento."""
    return [
        linha(f"r{c}_{i}", dominio, f"a_aut_{c}_{i}", lote)
        for c, (dominio, lote) in enumerate(CELULAS)
        for i in range(LINHAS_POR_CELULA)
    ]


def componentes(registros: list[dict]) -> dict[str, int]:
    """Tamanho de cada componente conexo, pela raiz."""
    tamanhos: dict[str, int] = {}
    for raiz in connected_components(registros).values():
        tamanhos[raiz] = tamanhos.get(raiz, 0) + 1
    return tamanhos


def maior_componente(registros: list[dict]) -> tuple[int, float]:
    tamanhos = componentes(registros)
    return len(tamanhos), max(tamanhos.values()) / len(registros)


def min_frac(registros: list[dict]) -> float:
    tamanhos = componentes(registros)
    return min(tamanhos.values()) / len(registros)


def pais_da_ilha(nome: str, quantos: int = 1) -> list[str]:
    """Ids de pai que caem no bloco de sementes da ilha `nome`, na ordem em que aparecem.

    A pista mista recusa pai de outra ilha, e o bucket e um `sha256` do id: um id escrito a
    mao cai em ilha arbitraria, e o fixture ficaria VAZIO sem que a assercao dissesse por
    que. Procurar aqui e o que torna a filtragem por ilha uma condicao medida do fixture em
    vez de uma coincidencia.
    """
    achados: list[str] = []
    for i in range(100_000):
        cid = f"src_pai_{i:06d}"
        dono = assemble_corpus.island_of_seed(assemble_corpus.ISLAND_PLAN, cid)
        if dono["island"] == nome:
            achados.append(cid)
            if len(achados) == quantos:
                return achados
    raise AssertionError(f"nao achei {quantos} pais para {nome!r} em 100.000 ids")


class ConectividadeSobAsChavesV4(unittest.TestCase):
    def test_a_uniao_e_exactamente_a_lista_v4(self):
        """Guarda de estado: o TEMPLATE esta DENTRO, a VERSAO e o par GROSSO estao fora.

        Escrito como igualdade e nao como pertinencia, e a ORDEM conta: `splitUnionAxes` da
        pre-inscricao selada e pinado por conteudo E ordem, entao uma lista de `assertIn`
        aceitaria um oitavo eixo acrescentado em silencio e tambem uma reordenacao que move
        o digest do artefato.
        """
        self.assertEqual(
            SPLIT_GROUP_KEYS,
            (
                "author",
                "source",
                "promptTemplate",
                "generationBatch",
                "nearDuplicate",
                "derivationRoot",
            ),
        )
        self.assertNotIn("domainSource", SPLIT_GROUP_KEYS)
        self.assertNotIn("sourceMaterialBatch", SPLIT_GROUP_KEYS)
        # O TEMPLATE entra pela perna (c): o recall que o release certifica reamostra por
        # familia -> template -> lote, entao o splitter tem de MODELAR a dependencia de
        # prompt. O preco e que o corpo tem de ser CONSTRUIDO em ilhas, e quem o cobra antes
        # da cota e `island_plan` no `type=` de `--island`.
        self.assertIn("promptTemplate", SPLIT_GROUP_KEYS)
        # A VERSAO fica fora, e e `namedReported`: a identidade dela e o id do modelo, entao
        # particiona-la por ilha custaria um modelo por ilha. O residuo e que a co-locacao de
        # versao nao e modelada.
        self.assertNotIn("generatorVersion", SPLIT_GROUP_KEYS)
        # A familia tambem fica fora, e agora nenhum membro da lista carrega a identidade
        # dela: a familia e de facto divisivel aqui, e quem a constrange e a reserva OOD.
        self.assertNotIn("generatorFamily", SPLIT_GROUP_KEYS)
        # O eixo diagnostico nunca une: reextrair o mesmo dump nao produz material novo.
        self.assertNotIn("extractionRun", SPLIT_GROUP_KEYS)

    def test_o_fixture_roda_sobre_as_celulas_DA_MOLDURA(self):
        """Guarda de estado do proprio fixture: as celulas vem do register, nao de uma lista a parte.

        Sem esta assercao, uma emenda da moldura deixa o fixture inteiro medindo celulas
        aposentadas e a suite verde — foi o estado em que este arquivo ficou quando as tres
        tipologias da Carolina sairam da moldura.
        """
        self.assertEqual(
            tuple(chave for chave, _ in CELULAS),
            tuple(sorted(assemble_corpus.REGISTER)),
        )
        self.assertEqual(
            {lote for _, lote in CELULAS},
            {LOTE_POR_FONTE[fonte] for fonte in assemble_corpus.HUMAN_SOURCE.values()},
        )
        # E o lote e o de uma fonte ESTOCADA, uma entrada por fonte que o montador le: uma
        # fonte fora da moldura nao tem bytes em disco para o fixture descrever.
        self.assertEqual(
            sorted(LOTE_POR_FONTE),
            sorted(set(assemble_corpus.HUMAN_SOURCE.values())),
        )
        # O corpo tem de ser fino o bastante para a menor particao, senao o caso VIAVEL
        # recusaria por tamanho de corpo e nao mediria granularidade alguma.
        self.assertLess(1 / LINHAS_NO_CORPO, MENOR_PARTICAO)

    def test_o_fixture_de_lote_unico_e_VIAVEL_sob_v4(self):
        """Quarenta linhas, quarenta componentes: 2,5% cada, e as duas condicoes passam.

        Passar aqui NAO e viabilidade provada — a atribuicao completa e soma de subconjuntos,
        e o preflight declara que nao a decide.
        """
        registros = corpo_de_lote_unico()
        self.assertEqual(len(registros), len(CELULAS) * LINHAS_POR_CELULA)
        # Nao vacuo: o estrato e o lote realmente carregam UM valor por celula, e o numero de
        # lotes e o numero de AQUISICOES, que pode ser menor que o de celulas.
        estratos = {r["groups"]["domainSource"]["id"] for r in registros}
        lotes = {r["groups"]["sourceMaterialBatch"]["id"] for r in registros}
        self.assertEqual(len(estratos), len(CELULAS))
        self.assertEqual(len(lotes), len({lote for _, lote in CELULAS}))

        quantos, maior = maior_componente(registros)
        self.assertEqual(quantos, len(registros))
        self.assertAlmostEqual(maior, 1 / len(registros), places=6)
        self.assertLess(min_frac(registros), MENOR_PARTICAO)
        assert_components_can_fill_five_partitions(registros)

    def test_devolver_o_ESTRATO_a_uniao_torna_o_mesmo_corpo_INVIAVEL(self):
        """Um componente por celula: com a moldura de uma celula, o corpo INTEIRO num bloco.

        A recusa nomeia fracao e nao tamanho de corpo, porque aumentar o corpo mantendo o
        numero de celulas nao muda fracao alguma. Com uma celula o unico componente vale 100 %,
        entao a condicao violada primeiro e a do MAIOR — nao ha particao que o receba inteiro.
        """
        registros = corpo_de_lote_unico()
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + ("domainSource",),
        ):
            quantos, maior = maior_componente(registros)
            self.assertEqual(quantos, len(CELULAS))
            self.assertAlmostEqual(maior, 1 / len(CELULAS), places=6)
            self.assertGreater(min_frac(registros), MENOR_PARTICAO + 0.02)
            with self.assertRaises(UnsplittableCorpus) as erro:
                assert_components_can_fill_five_partitions(registros)
        self.assertIn("maior componente", str(erro.exception))

    def test_devolver_o_LOTE_a_uniao_torna_o_mesmo_corpo_INVIAVEL(self):
        """Um componente por AQUISICAO, e com uma fonte estocada isso e o corpo inteiro.

        Esta e a direcao que o inventario real decide: um download por fonte, e as tipologias
        de um pacote sao particoes dele e nao aquisicoes separadas. Com uma fonte em moldura o
        lote nao pode fundir MENOS que o estrato — no maximo tanto —, e e por isso que a
        direcao continua escrita mesmo coincidindo com a de cima.

        A recusa e a do MAIOR: o unico componente vale 100 %, e nenhuma particao o recebe
        inteiro. O ramo do MENOR fica isolado em
        `test_recusa_granularidade_grosseira_pelo_MENOR_componente`, que e um corpo onde o do
        maior nao pode disparar.
        """
        registros = corpo_de_lote_unico()
        aquisicoes = len({lote for _, lote in CELULAS})
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + ("sourceMaterialBatch",),
        ):
            quantos, maior = maior_componente(registros)
            self.assertEqual(quantos, aquisicoes)
            self.assertLessEqual(quantos, len(CELULAS))
            self.assertAlmostEqual(maior, 1 / aquisicoes, places=6)
            with self.assertRaises(UnsplittableCorpus) as erro:
                assert_components_can_fill_five_partitions(registros)
        self.assertIn("maior componente", str(erro.exception))

    def test_devolver_o_ESTRATO_colapsa_a_CLASSE_gerada_tambem(self):
        """O estrato na uniao nao e defeito so do lado humano: a lane tambem e um valor unico.

        Sem esta medicao a recusa acima se leria como propriedade da celula humana, e devolver
        o estrato a uniao pareceria seguro para o corpus gerado. Sessenta linhas geradas de uma
        lane, cada uma com template, versao e lote proprios — grao fino sob as chaves v4 —,
        caem num componente unico quando `domainSource` une.
        """
        geradas = [linha_gerada(f"g{i}", f"ausente_{i}", "ai_agy") for i in range(60)]
        self.assertEqual(len(componentes(geradas)), len(geradas))
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + ("domainSource",),
        ):
            self.assertEqual(len(componentes(geradas)), 1)

    def test_o_lote_de_GERACAO_continua_unindo(self):
        """O eixo de lote que sobrou na uniao une de verdade — senao a troca perdeu um eixo.

        Duas linhas geradas do mesmo lote sao um componente; de lotes diferentes, dois. E o
        que separa "trocamos `collectionBatch` por `generationBatch`" de "tiramos o eixo de
        lote da uniao".
        """
        def gerada(rec_id: str, lote: str) -> dict:
            return {
                "id": rec_id,
                "schemaVersion": 4,
                "label": "ai",
                "groups": {
                    "author": group_axes.not_applicable(group_axes.NO_HUMAN_AUTHOR),
                    "source": group_axes.not_applicable("texto gerado"),
                    "domainSource": group_axes.known("ai_agy"),
                    "promptTemplate": group_axes.known(f"pt_{rec_id}"),
                    "generatorVersion": group_axes.known(f"gv_{rec_id}"),
                    "sourceMaterialBatch": group_axes.not_applicable(
                        group_axes.NO_MATERIAL_ACQUIRED
                    ),
                    "generationBatch": group_axes.known(lote),
                    "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
                    "nearDuplicate": group_axes.known(f"nd_{rec_id}"),
                    "derivationRoot": group_axes.not_applicable(
                        group_axes.NO_DERIVATION
                    ),
                },
            }

        juntas = [gerada("a1", "gb_agy_1"), gerada("a2", "gb_agy_1")]
        self.assertEqual(len(componentes(juntas)), 1)
        separadas = [gerada("a3", "gb_agy_1"), gerada("a4", "gb_agy_2")]
        self.assertEqual(len(componentes(separadas)), 2)


class CriterioDaListaDeUniao(unittest.TestCase):
    """A lista de uniao tem CRITERIO, e o criterio e verificavel eixo por eixo.

    TODO eixo de `SPLIT_GROUP_KEYS` identifica MATERIAL — e membro de
    `EXPOSURE_IDENTITY_AXES`, a lista que o ledger executa para decidir que a mesma unidade
    de amostragem reapareceu — ou a uniao por ele e INERTE sobre o corpo montado, medida como
    "o numero de componentes com o eixo na lista e igual ao numero sem ele".

    E condicao NECESSARIA, e a RECIPROCA E FALSA: `humanSeed` cumpre a primeira perna e e
    eixo de LINHAGEM, `extractionRun` cumpre a segunda (medido abaixo) e e DIAGNOSTICO. Um
    "se e somente se" aqui concluiria que `humanSeed` deve entrar na lista de uniao, que e a
    mudanca que o contrato recusou, e "todo outro eixo e reportado" seria falso para
    `generatorFamily`, `generationLane` e `harnessVersion`, que nenhuma das quatro listas
    nomeia. A funcao total sobre os catorze eixos e `groupAxisRole`
    (benchmark/split-audit.ts), e e la que o residuo esta declarado.

    O laco percorre TODOS os eixos da lista, e nao uma amostra: um `assertIn` por eixo
    escolhido a mao aceita em silencio o sexto que alguem acrescentar.
    """

    def setUp(self):
        catalogo = json.loads(CATALOGO.read_text(encoding="utf-8"))
        self.corpos = [
            (caso["name"], _linhas_do_caso(caso, catalogo["generatedStratum"]))
            for caso in catalogo["cases"]
        ]

    def _componentes_sob(self, registros: list[dict], chaves: tuple[str, ...]) -> int:
        with mock.patch.object(assemble_corpus, "SPLIT_GROUP_KEYS", chaves):
            return len(componentes(registros))

    def test_todo_eixo_da_uniao_identifica_material_ou_une_nada_ou_e_imposto(self):
        """O espelho do laco de tres pernas, e cada eixo cai em EXACTAMENTE uma.

        As tres listas de admissao sao LIDAS de benchmark/split.ts, nunca retypadas aqui:
        uma copia deixaria este lado classificar por uma lista que a producao nao publica.
        """
        material = eixos_de_identidade_de_material()
        inertes = _lista_do_split_ts("INERT_UNION_AXES")
        impostos = _lista_do_split_ts("IMPOSED_UNION_AXES")
        por_material: list[str] = []
        por_inercia: list[str] = []
        por_imposta: list[str] = []
        medida = next(
            r for n, r in self.corpos if n == "forma-medida-da-classe-gerada"
        )
        for eixo in SPLIT_GROUP_KEYS:
            pernas = [eixo in material, eixo in inertes, eixo in impostos]
            with self.subTest(eixo=eixo):
                # EXACTAMENTE uma: um eixo em duas listas nao tem perna que o decida.
                self.assertEqual(sum(1 for p in pernas if p), 1)
            if pernas[0]:
                por_material.append(eixo)
                continue
            sem_o_eixo = tuple(k for k in SPLIT_GROUP_KEYS if k != eixo)
            if pernas[1]:
                por_inercia.append(eixo)
                for nome, registros in self.corpos:
                    with self.subTest(eixo=eixo, caso=nome):
                        self.assertEqual(
                            self._componentes_sob(registros, SPLIT_GROUP_KEYS),
                            self._componentes_sob(registros, sem_o_eixo),
                        )
                continue
            por_imposta.append(eixo)
            # A perna IMPOSTA, por eixo: sobre o corpo que existe, tirar este eixo da uniao
            # MUDA a contagem — e a medicao de inercia com o sinal trocado, e e o que diz
            # que a perna (b) nao estava disponivel.
            with self.subTest(eixo=eixo):
                self.assertNotEqual(
                    self._componentes_sob(medida, SPLIT_GROUP_KEYS),
                    self._componentes_sob(medida, sem_o_eixo),
                )
        # Nao vacuo nas TRES pernas, e por IGUALDADE contra as listas publicadas.
        self.assertEqual(por_material, ["author", "source", "derivationRoot"])
        self.assertEqual(por_inercia, list(inertes))
        self.assertEqual(por_imposta, list(impostos))
        self.assertEqual(list(impostos), ["promptTemplate"])
        # A VIABILIDADE e medida nas DUAS pontas e sob a MESMA lista de uniao: a forma dos
        # pools deixa um componente que particao alguma recebe, e a de ilhas nao.
        ilhas = next(r for n, r in self.corpos if n == "ilhas-de-receita-que-passam")
        self.assertEqual(self._componentes_sob(medida, SPLIT_GROUP_KEYS), 4)
        with mock.patch.object(
            assemble_corpus, "SPLIT_GROUP_KEYS", SPLIT_GROUP_KEYS
        ):
            self.assertAlmostEqual(
                max(componentes(medida).values()) / 1170, 0.547863, places=6
            )
        self.assertEqual(self._componentes_sob(ilhas, SPLIT_GROUP_KEYS), 40)

    def test_a_perna_de_inercia_e_uma_medicao_e_nao_uma_formalidade(self):
        """O contraste: um eixo que NAO e inerte muda a contagem, e por isso e recusado.

        Sem esta medicao a perna de inercia passaria por qualquer eixo, inclusive um que
        colapsa uma celula de quota inteira num componente.

        Ancorado em `domainSource` SOBRE CORPO COM LINHA HUMANA, e as duas coisas sao
        necessarias: `promptTemplate` ja esta na uniao, entao acrescenta-lo e no-op e o
        contraste mediria a si mesmo; e sobre a classe gerada `domainSource` e um valor unico
        por lane, entao o contraste ali confundiria "nao e inerte" com "colapsa a lane".
        """
        registros = next(r for n, r in self.corpos if n == "lote-unico-por-celula")
        base = self._componentes_sob(registros, SPLIT_GROUP_KEYS)
        com_o_eixo = self._componentes_sob(
            registros, SPLIT_GROUP_KEYS + ("domainSource",)
        )
        self.assertNotEqual(base, com_o_eixo)
        # E o contraste e FORTE e nao marginal: quarenta componentes viram quatro.
        self.assertEqual(base, 40)
        self.assertEqual(com_o_eixo, 4)

    def test_nenhum_eixo_de_material_fica_fora_das_duas_relacoes(self):
        """A reciproca. Sem ela a lista poderia perder um eixo de material e ficar verde."""
        relacoes = set(SPLIT_GROUP_KEYS) | set(SPLIT_PARENT_LINKAGE_AXES)
        for eixo in eixos_de_identidade_de_material():
            with self.subTest(eixo=eixo):
                self.assertIn(eixo, relacoes)

    def test_a_reciproca_do_criterio_e_FALSA_nos_dois_sentidos(self):
        """Os dois eixos que refutam o bicondicional, um por perna.

        `humanSeed` cumpre a perna de MATERIAL e nao esta na lista de uniao: a identidade dele
        nomeia o ID DE OUTRA LINHA, entao a relacao dele e linhagem de pai e nao valor
        compartilhado. `extractionRun` cumpre a perna de INERCIA sobre a classe gerada — e
        MEDIDO aqui, nao argumentado, porque `notApplicable` em toda linha gerada nao une nada
        — e tambem nao esta: reextrair o mesmo dump nao produz material novo, entao unir por
        ele contaria uma dependencia duas vezes.

        O ESCOPO da segunda medicao esta no teste, e nao e detalhe: sobre um corpo com linha
        HUMANA o mesmo eixo NAO e inerte, porque uma extracao escreve milhares de linhas com o
        mesmo `extractionRun`. Inercia e propriedade do CORPO medido, entao cumprir a perna (b)
        num corpo nao e licenca para unir — que e a razao pela qual o criterio nao pode ser
        lido como bicondicional.
        """
        material = eixos_de_identidade_de_material()
        self.assertIn("humanSeed", material)
        self.assertNotIn("humanSeed", SPLIT_GROUP_KEYS)
        self.assertIn("humanSeed", SPLIT_PARENT_LINKAGE_AXES)

        self.assertNotIn("extractionRun", material)
        self.assertNotIn("extractionRun", SPLIT_GROUP_KEYS)
        self.assertNotIn("extractionRun", SPLIT_PARENT_LINKAGE_AXES)
        nome, gerado = next(
            (n, r) for n, r in self.corpos if n == "forma-medida-da-classe-gerada"
        )
        del nome
        self.assertEqual(
            self._componentes_sob(gerado, SPLIT_GROUP_KEYS),
            self._componentes_sob(gerado, SPLIT_GROUP_KEYS + ("extractionRun",)),
        )

        # O CONTRASTE, que e o que impede a perna (b) de virar formalidade: um corpo com
        # linha humana muda a contagem, entao a inercia medida acima vale para a classe
        # gerada de hoje e para nada mais.
        com_humanas = [
            r
            for n, corpo in self.corpos
            if n == "lote-unico-por-celula"
            for r in corpo
        ]
        self.assertNotEqual(
            self._componentes_sob(com_humanas, SPLIT_GROUP_KEYS),
            self._componentes_sob(com_humanas, SPLIT_GROUP_KEYS + ("extractionRun",)),
        )


class OCarimboPoeOComponenteInteiroNumBloco(unittest.TestCase):
    """A guarda do carimbo tem CHAMADOR DE PRODUCAO, e o corpo que so ela recusa.

    `assign_partitions` carimba por componente, entao ela nao produz travessia — e uma
    assercao que so chamasse a guarda provaria o critério e nada sobre o sitio. O que este
    teste faz e substituir o PLANEJADOR pelo passeio por posicao que a emenda tirou, que e a
    unica forma de o carimbador emitir um corpo com componente atravessando, e medir que:

      * a guarda chamada de DENTRO de `assign_partitions` recusa, nomeando o componente e os
        dois blocos;
      * `assert_stamped_corpus_is_splittable`, sobre o MESMO corpo carimbado, NAO recusa.

    A segunda metade e o que da peso a primeira: apagar a chamada da guarda deixaria este
    corpo passar ponta a ponta, com um componente conexo em duas particoes.
    """

    def corpo_de_pares(self) -> list[dict]:
        """Cem linhas humanas em cinquenta pares de autor: 2 % por componente.

        Cem e nao quarenta porque a travessia tem de ser INVISIVEL para a guarda de fracao:
        mover uma linha de `dev` para `train` custa 1/N a cada uma das duas, e com N = 40 isso
        e 2,5 pontos, acima da tolerancia. Com N = 100 e um ponto, dentro dela — e e nesse
        corpo que a travessia so aparece na guarda de componente.

        `provenance` existe porque `stamp_block` escreve `collectedAt` nela, e fica SEM
        `sourceId`: nomear uma fonte inventariada faria a guarda do corpo estampado conferir
        os eixos que aquela fonte declara, que e outra coisa a medir aqui.
        """
        registros = [
            linha(f"r{i:03d}", CELULAS[0][0], f"a_aut_{i // 2}", CELULAS[0][1])
            for i in range(100)
        ]
        for rec in registros:
            rec["provenance"] = {}
        return registros

    @staticmethod
    def plano_por_posicao(records: list[dict], held_out: set[str]) -> dict[str, str]:
        """O passeio POR POSICAO: fatia a lista pelos tamanhos dos blocos, na ordem temporal."""
        del held_out
        n = len(records)
        tamanhos = {b: round(n * CLASS_FRACTIONS[b]) for b in CLASS_FRACTIONS}
        plano: dict[str, str] = {}
        cursor = 0
        for bloco, tamanho in tamanhos.items():
            for rec in records[cursor : cursor + tamanho]:
                plano[rec["id"]] = bloco
            cursor += tamanho
        for rec in records[cursor:]:
            plano[rec["id"]] = "test"
        return plano

    def test_a_montagem_de_verdade_chama_a_guarda_do_carimbo(self):
        registros = self.corpo_de_pares()
        # A fronteira de `train` cai em 45, que e impar, e os pares sao (2i, 2i+1): o par
        # (44, 45) fica com uma linha em `train` e outra em `dev`. Nao vacuo por construcao,
        # e a assercao seguinte mede que e exatamente UM par.
        self.assertEqual(len(componentes(registros)), 50)
        assemble_corpus.PARTITION_OF.clear()
        try:
            with mock.patch.object(
                assemble_corpus, "_plano_de_blocos", self.plano_por_posicao
            ):
                with self.assertRaises(UnsplittableCorpus) as erro:
                    assemble_corpus.assign_partitions(registros, set())
            mensagem = str(erro.exception)
            self.assertIn("componente conexo INTEIRO numa unica particao", mensagem)
            self.assertIn("carimbado em mais de um bloco", mensagem)
            self.assertIn("dev, train", mensagem)
            # O componente NOMEADO, e a linha que leva o carimbo divergente: sem os dois o
            # operador le que algo atravessou e nao o que atravessou.
            self.assertIn("'r044'", mensagem)
            self.assertIn("r045 leva dev", mensagem)
            atravessando = [
                raiz
                for raiz, blocos in assemble_corpus._blocos_por_componente(
                    registros
                ).items()
                if len(blocos) > 1
            ]
            self.assertEqual(len(atravessando), 1)
            # E AQUI ESTA O PESO: o corpo carimbado passa por todas as outras guardas.
            assert_stamped_corpus_is_splittable(registros, set())
        finally:
            assemble_corpus.PARTITION_OF.clear()

    def test_o_carimbo_por_componente_nao_produz_travessia_nenhuma(self):
        """O contraste, no MESMO corpo: com o planejador de producao, zero travessias."""
        registros = self.corpo_de_pares()
        assemble_corpus.PARTITION_OF.clear()
        try:
            assemble_corpus.assign_partitions(registros, set())
            atravessando = [
                raiz
                for raiz, blocos in assemble_corpus._blocos_por_componente(
                    registros
                ).items()
                if len(blocos) > 1
            ]
            self.assertEqual(atravessando, [])
            realizados = assemble_corpus.realized_blocks(registros)
            self.assertEqual(
                {i: realizados[i] for i in realizados},
                {i: b for i, b in assemble_corpus.PARTITION_OF.items()},
            )
        finally:
            assemble_corpus.PARTITION_OF.clear()


class PreflightDeViabilidade(unittest.TestCase):
    def test_os_cinco_alvos_somam_um(self):
        self.assertEqual(len(FIVE_TARGETS), 5)
        self.assertAlmostEqual(sum(FIVE_TARGETS), 1.0, places=10)

    def test_recusa_granularidade_grosseira_pelo_MENOR_componente(self):
        """Cinco componentes de 20%: cabem no maior alvo e nenhum cabe no de 5%.

        A condicao afiada, exercitada sem tocar na lista de uniao: os pares se unem por
        `author`, que E um eixo de uniao v4. A recusa nomeia granularidade e nao tamanho de
        corpo, porque aumentar o corpo mantendo cinco componentes nao muda fracao alguma.
        """
        registros = [
            linha(f"r{i}", "ptwiki_lead", f"a_aut_{i // 2}", "smb_ptwiki_20220301")
            for i in range(10)
        ]
        self.assertEqual(len(componentes(registros)), 5)
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions(registros)
        self.assertIn("MENOR componente", str(erro.exception))
        self.assertIn("granularidade", str(erro.exception))

    def test_com_UMA_celula_a_recusa_e_da_CLASSE_humana_e_nao_do_corpo(self):
        """A comparacao POR CLASSE, sob a moldura de uma celula, e sem tocar a lista de uniao.

        Este e o corpo caro: a metade gerada de grao fino derruba toda fracao agregada, entao a
        comparacao so agregada PASSA e a degeneracao humana atravessa. Quarenta linhas humanas
        compartilhando autor — `author` E eixo de uniao v4, logo a degeneracao e alcancavel sem
        mock nenhum — mais sessenta geradas finas: no CORPO o maior componente vale 40 %, que
        cabe em `train` (45 % ± 2 %), e na classe `human` vale 100 %, que nao cabe em particao
        alguma. Com uma celula em moldura, um componente por celula E a classe humana inteira.
        """
        humanas = [
            linha(f"h{i}", CELULAS[0][0], "a_aut_unico", CELULAS[0][1])
            for i in range(40)
        ]
        geradas = [linha_gerada(f"g{i}", f"ausente_{i}", "ai_agy") for i in range(60)]
        registros = humanas + geradas
        # O escopo AGREGADO passa nas duas condicoes: 40 % cabe no maior alvo, e o menor
        # componente vale 1 %, que cabe no menor.
        _, maior_no_corpo = maior_componente(registros)
        self.assertAlmostEqual(maior_no_corpo, 0.40, places=6)
        self.assertLess(maior_no_corpo, max(FIVE_TARGETS) + 0.02)
        self.assertLess(min_frac(registros), MENOR_PARTICAO)
        # E na classe `human` o mesmo componente e a classe inteira.
        _, maior_na_classe = maior_componente(humanas)
        self.assertAlmostEqual(maior_na_classe, 1.0, places=6)
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions(registros)
        self.assertIn('da classe "human"', str(erro.exception))
        self.assertIn("maior componente", str(erro.exception))

    def test_recusa_componente_que_nao_cabe_em_particao_alguma(self):
        """Um componente de 60% não cabe nem no maior alvo (45% + 0,02).

        Como o corpo de 25/75 acima, este viola as duas condicoes — o outro componente vale
        40%, e 40% > 7% —, e o preflight relata a primeira.
        """
        registros = []
        for i in range(10):
            # Seis linhas compartilham autor: um componente de 60%, outro de 40%.
            autor = "a_aut_gigante" if i < 6 else f"a_aut_{i}"
            registros.append(linha(f"r{i}", "ptwiki_lead", autor, "smb_ptwiki_20220301"))
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions(registros)
        self.assertIn("maior componente", str(erro.exception))

    def test_recusa_SO_pelo_maior_componente(self):
        """O unico corpo em que o ramo do MENOR nao pode disparar, so o do MAIOR.

        Sessenta linhas num componente (60%) e quarenta em componentes de uma linha (1% cada).
        O menor vale 1%, que CABE na particao de 5%, entao a condicao afiada esta satisfeita e
        a unica recusa possivel e a do maior. Sem este corpo, relaxar o ramo do maior deixa os
        dois testes acima vermelhos pelo ramo do menor e o ramo do maior sem medicao.
        """
        registros = [
            linha(
                f"r{i}",
                "ptwiki_lead",
                "a_aut_gigante" if i < 60 else f"a_aut_{i}",
                "smb_ptwiki_20220301",
            )
            for i in range(100)
        ]
        # Nao vacuo nas DUAS pontas: o maior excede o maior alvo e o menor cabe no menor.
        self.assertAlmostEqual(max(componentes(registros).values()) / 100, 0.60, places=6)
        self.assertAlmostEqual(min_frac(registros), 0.01, places=6)
        self.assertLess(min_frac(registros), MENOR_PARTICAO)
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions(registros)
        self.assertIn("maior componente", str(erro.exception))
        self.assertNotIn("MENOR componente", str(erro.exception))

    def test_o_RAMO_da_recusa_por_numero_de_celulas_CONTRAFACTUAL(self):
        """A aritmetica de n celulas MEDIDA, e ela e CONTRAFACTUAL de ponta a ponta.

        Este corpo descreve material que ninguem tem, e o cabecalho deste arquivo proibe usar
        um corpo assim para PROVAR VIABILIDADE. Nao e o que se faz aqui, e a diferenca e a
        pergunta: nao se pergunta se um corpo de n celulas e viavel, e sim QUAL DOS DOIS RAMOS
        do preflight recusa quando a fracao por componente e 1/n. Nada nesta medicao afirma
        que material de n celulas exista, seja adquirivel ou seja divisivel. Por isso ele nao
        usa `corpo_de_lote_unico()` e nao tira linha alguma de `CELULAS`: as linhas sao
        sinteticas e as celulas sao inventadas. `len(CELULAS)` entra so como NUMERO — o n da
        moldura de hoje, derivado do register do montador em vez de digitado.

        E passar aqui nao seria viabilidade nem se o corpo fosse real: o docstring de
        `assert_components_can_fill_five_partitions` declara que as duas condicoes sao
        NECESSARIAS e que a atribuicao completa e soma de subconjuntos, que ele nao decide.

        A prosa que esta medicao sustenta e a dos quatro sitios que marcam a aritmetica de
        quatro celulas como contrafactual: com n celulas o RAMO da recusa muda, e "mais
        celulas so suavizam sem reparar" tem um LIMITE. Os dois limites sao LIDOS de
        `assemble_corpus` — quem os define —, nunca de uma tabela digitada aqui: relaxar
        `CLASS_TOLERANCE` ou mover um alvo de `FIVE_TARGETS` faz o ramo esperado e a mensagem
        levantada discordarem, e a discordancia e o vermelho.

        Vinte linhas por celula, cada uma no seu documento e com o seu autor, entao o unico
        eixo que une e o `domainSource` devolvido a uniao pelo mock — o mesmo mock das duas
        direcoes acima — e a fracao de cada componente e exatamente 1/n.
        """
        limite_max = (
            max(FIVE_TARGETS)
            + assemble_corpus.CLASS_TOLERANCE
            + assemble_corpus.CLASS_TOLERANCE_EPSILON
        )
        limite_min = (
            min(FIVE_TARGETS)
            + assemble_corpus.CLASS_TOLERANCE
            + assemble_corpus.CLASS_TOLERANCE_EPSILON
        )
        # O n da moldura de hoje primeiro, e depois a virada do ramo (3), a aritmetica de
        # quatro celulas, a ultima que recusa (14) e a fronteira em que o preflight para de
        # recusar (15). Sem o ultimo caso o limite volta a ser afirmacao em vez de medicao.
        roster = (len(CELULAS), 2, 3, 4, 14, 15)
        ramos: list[str | None] = []
        for n in roster:
            with self.subTest(celulas=n):
                registros = [
                    linha(f"c{c}_r{i}", f"cf_cel_{c}", f"a_cf_{c}_{i}", f"smb_cf_{c}")
                    for c in range(n)
                    for i in range(20)
                ]
                with mock.patch.object(
                    assemble_corpus,
                    "SPLIT_GROUP_KEYS",
                    SPLIT_GROUP_KEYS + ("domainSource",),
                ):
                    quantos, maior = maior_componente(registros)
                    # O corpo E o que a aritmetica descreve, antes de qualquer veredito.
                    self.assertEqual(quantos, n)
                    self.assertAlmostEqual(maior, 1 / n, places=9)
                    self.assertAlmostEqual(min_frac(registros), 1 / n, places=9)

                    esperado = (
                        "maior"
                        if 1 / n > limite_max
                        else "menor"
                        if 1 / n > limite_min
                        else None
                    )
                    ramos.append(esperado)
                    if esperado is None:
                        # Nao recusar NAO e viabilidade: as duas condicoes sao necessarias e
                        # a atribuicao completa e soma de subconjuntos.
                        assert_components_can_fill_five_partitions(registros)
                        continue
                    with self.assertRaises(UnsplittableCorpus) as erro:
                        assert_components_can_fill_five_partitions(registros)
                    mensagem = str(erro.exception)
                    if esperado == "maior":
                        self.assertIn("maior componente", mensagem)
                        self.assertNotIn("MENOR componente", mensagem)
                    else:
                        self.assertIn("MENOR componente", mensagem)
                        self.assertNotIn("maior componente", mensagem)

        # O roster exercita os TRES ramos, e nao dois deles varias vezes.
        self.assertEqual(set(ramos), {"maior", "menor", None})
        # E EXATAMENTE um n do roster escapa da recusa. Tirar o caso da fronteira deixa esta
        # contagem em zero, e "mais celulas so suavizam sem reparar" volta a ser afirmacao
        # sem limite medido.
        self.assertEqual(sum(1 for ramo in ramos if ramo is None), 1)

    def test_recusa_corpo_vazio(self):
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions([])
        self.assertIn("corpo vazio", str(erro.exception))

    def test_a_montagem_de_verdade_chama_esta_guarda_antes_de_carimbar(self):
        """A guarda tem CHAMADOR DE PRODUCAO, e nao so testes.

        `assign_partitions` e o caminho da montagem real. Sem esta assercao, apagar a chamada
        de la deixaria a suite inteira verde e o diagnostico de componente existiria apenas no
        benchmark — o operador veria, no lado Python, so "fracao por classe".

        O corpo e um componente por celula: a guarda estoura ANTES de qualquer carimbo, entao
        nada aqui escreve bloco em registro algum.
        """
        registros = corpo_de_lote_unico()
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + ("domainSource",),
        ):
            with self.assertRaises(UnsplittableCorpus) as erro:
                assemble_corpus.assign_partitions(registros, set())
        self.assertIn("maior componente", str(erro.exception))
        self.assertNotIn("block", registros[0])


# O catalogo COMPARTILHADO com o preflight do benchmark
# (`benchmark/viability-preflight.ts`, exercitado em
# `benchmark/tests/viability-preflight.test.ts`). Os dois lados leem ESTE arquivo: um
# catalogo por lado deixaria cada um provar a propria regra sobre o proprio corpo, que e
# a forma de discordar sem que nada fique vermelho.
CATALOGO = (
    Path(__file__).resolve().parent.parent
    / "tests"
    / "fixtures"
    / "viability-agreement.json"
)

# O vocabulario de recusa do preflight -> o trecho que ESTA guarda escreve. A traducao
# vive deste lado e nao no catalogo: se a guarda passar a recusar pelo outro ramo, o
# vermelho aparece aqui, em vez de o catalogo ser reescrito para acomoda-la.
MARCADOR_DA_RECUSA = {
    "largest-component-exceeds-largest-target": "maior componente",
    "smallest-component-exceeds-smallest-target": "MENOR componente",
}

# O ESCOPO da recusa, pelo mesmo mecanismo. Sem ele a concordancia diria apenas que os dois
# lados recusam pela mesma condicao, e nao que recusam olhando o mesmo denominador — que e
# justamente onde uma comparacao so agregada e uma por classe divergem.
MARCADOR_DO_ESCOPO = {
    "corpus": "do corpo",
    "human": 'da classe "human"',
    "ai": 'da classe "ai"',
    "mixed": 'da classe "mixed"',
}


def _identidades_de_receita(
    corridas: list[int], prefixo: str, geradas: int, nome: str
) -> list[str]:
    """A identidade de cada linha gerada num eixo de receita, expandida das corridas.

    Falha fechada quando as corridas nao cobrem exatamente as linhas geradas do caso: uma
    lista curta deixaria a cauda com identidade por linha e mediria, em silencio, uma forma
    mais fina do que o caso declara.
    """
    rotulos = [f"{prefixo}_{i}" for i, n in enumerate(corridas) for _ in range(n)]
    if len(rotulos) != geradas:
        raise RuntimeError(
            f'o caso "{nome}" declara corridas de {prefixo} somando {len(rotulos)} e tem '
            f"{geradas} linha(s) gerada(s)"
        )
    return rotulos


def _linhas_geradas_do_caso(caso: dict) -> int:
    return sum(
        corrida["count"] * corrida["lines"].get("ai", 0)
        for celula in caso["cells"]
        for corrida in celula["components"]
    )


def _linhas_do_caso(caso: dict, estrato_gerado: str) -> list[dict]:
    """Materializa um caso do catalogo pela regra que o proprio catalogo declara.

    As linhas HUMANAS de um componente COMPARTILHAM o autor — `author` e eixo de uniao
    v4 — e as linhas GERADAS do mesmo componente nomeiam em `humanSeed` a primeira linha
    humana dele, que e o eixo de LINHAGEM DE PAI. Cada linha fica com seu documento de
    origem e seu grupo de quase-duplicata, entao o tamanho do componente e o numero de
    linhas declarado e nada mais as gruda. O estrato e o lote valem para as linhas
    humanas da celula e carregam UM valor por celula, que e justamente a forma que
    colapsaria a celula se um deles unisse; linha gerada carrega o estrato da lane e
    nenhum lote de material.

    `generatedRecipe`, quando o caso o declara, da as identidades de `promptTemplate` e
    `generatorVersion` por CORRIDA, na ordem em que as linhas geradas saem daqui.
    """
    receita = caso.get("generatedRecipe")
    geradas = _linhas_geradas_do_caso(caso)
    templates = (
        _identidades_de_receita(
            receita["promptTemplateRuns"], "pt", geradas, caso["name"]
        )
        if receita
        else None
    )
    versoes = (
        _identidades_de_receita(
            receita["generatorVersionRuns"], "gv", geradas, caso["name"]
        )
        if receita
        else None
    )
    indice_gerado = 0
    registros: list[dict] = []
    for indice_celula, celula in enumerate(caso["cells"]):
        componente = 0
        for corrida in celula["components"]:
            for _ in range(corrida["count"]):
                marca = f"{indice_celula}_{componente}"
                humanas = corrida["lines"].get("human", 0)
                for indice in range(humanas):
                    registros.append(
                        linha(
                            f"h_{marca}_{indice}",
                            celula["stratum"],
                            f"au_hmac_{marca}",
                            celula["materialBatch"],
                        )
                    )
                for indice in range(corrida["lines"].get("ai", 0)):
                    semente = (
                        f"h_{marca}_0" if humanas else f"h_ausente_{marca}_{indice}"
                    )
                    registros.append(
                        linha_gerada(
                            f"a_{marca}_{indice}",
                            semente,
                            estrato_gerado,
                            templates[indice_gerado] if templates else None,
                            versoes[indice_gerado] if versoes else None,
                        )
                    )
                    indice_gerado += 1
                for indice in range(corrida["lines"].get("mixed", 0)):
                    if not humanas:
                        raise RuntimeError(
                            f'o caso "{caso["name"]}" declara linha mista em componente sem '
                            "linha humana: a mista nao teria pai a nomear"
                        )
                    registros.append(
                        linha_mista(
                            f"m_{marca}_{indice}",
                            f"h_{marca}_0",
                            celula["stratum"],
                            f"au_hmac_{marca}",
                            celula["materialBatch"],
                        )
                    )
                componente += 1
    return registros


def _histograma(registros: list[dict]) -> list[int]:
    return sorted(componentes(registros).values())


def _classes(registros: list[dict]) -> dict[str, int]:
    """Linhas por classe — o denominador que as condicoes por classe dividem por."""
    contagem: dict[str, int] = {}
    for rec in registros:
        contagem[rec["label"]] = contagem.get(rec["label"], 0) + 1
    return contagem


def _chave_conjunta(linhas: dict) -> str:
    """A composicao de UM componente por classe, canonica.

    TODA classe aparece com a sua contagem, e nao so as que o componente tem: senao
    `human=1` e `human=1,mixed=0` seriam duas grafias do mesmo componente e os dois lados
    poderiam discordar por omissao. A ordem e lida de `LABEL_REPORT_ORDER` do montador, e nao
    retypada, pela mesma razao que o resto do espelho a le.
    """
    return ",".join(
        f"{classe}={linhas.get(classe, 0)}"
        for classe in assemble_corpus.LABEL_REPORT_ORDER
    )


def _conjunto_declarado(caso: dict) -> list[str]:
    """Linhas por componente E por classe, DECLARADAS: o conjunto de que `_histograma` e
    `_classes` sao as duas marginais."""
    return sorted(
        _chave_conjunta(corrida["lines"])
        for celula in caso["cells"]
        for corrida in celula["components"]
        for _ in range(corrida["count"])
    )


def _conjunto_medido(registros: list[dict]) -> list[str]:
    """O mesmo conjunto, MEDIDO pela conectividade do montador."""
    raizes = connected_components(registros)
    por_raiz: dict[str, dict[str, int]] = {}
    for rec in registros:
        contagem = por_raiz.setdefault(raizes[rec["id"]], {})
        contagem[rec["label"]] = contagem.get(rec["label"], 0) + 1
    return sorted(_chave_conjunta(contagem) for contagem in por_raiz.values())


def _identidades(registros: list[dict], eixo: str) -> set[str]:
    """As identidades DEFINIDAS de um eixo: `notApplicable` nao e um valor a contar."""
    valores = set()
    for rec in registros:
        identidade = group_axes.identity_of(rec["groups"].get(eixo))
        if identidade is not None:
            valores.add(identidade)
    return valores


class ConcordanciaComOPreflightDoBenchmark(unittest.TestCase):
    """O MESMO corpo, o MESMO veredito, nos dois lados da fronteira de linguagem.

    Concordar num corpo viavel e o barato. O que separa "mesma regra" de "mesmo
    resultado" e os dois lados concordarem sobre QUAL condicao recusa e em QUAL escopo —
    o corpo agregado ou uma classe —, e e por isso que o catalogo carrega a lista
    ordenada de violacoes com escopo, e nao um booleano.
    """

    @classmethod
    def setUpClass(cls):
        cls.catalogo = json.loads(CATALOGO.read_text(encoding="utf-8"))
        # Falha fechada na vacuidade: um catalogo sem caso deixaria o laco abaixo rodar
        # zero asserção e reportar verde.
        if not cls.catalogo["cases"]:
            raise RuntimeError(
                f"{CATALOGO} declara zero casos: a suite de concordancia ficaria verde "
                "sem medir nada"
            )

    def test_os_alvos_extremos_do_catalogo_sao_os_que_esta_guarda_usa(self):
        """A concordancia sobre os NUMEROS, e nao so sobre os vereditos.

        Dois lados que derivassem alvos diferentes ainda poderiam coincidir por acidente
        nos corpos deste catalogo — 60% nao cabe em 45% nem em 40%.
        """
        alvos = self.catalogo["extremeTargets"]
        por_nome = dict(CLASS_FRACTIONS)
        por_nome["test"] = round(1.0 - sum(CLASS_FRACTIONS.values()), 10)
        self.assertAlmostEqual(max(FIVE_TARGETS), alvos["largest"]["fraction"], places=10)
        self.assertAlmostEqual(min(FIVE_TARGETS), alvos["smallest"]["fraction"], places=10)
        self.assertEqual(por_nome[alvos["largest"]["partition"]], max(FIVE_TARGETS))
        self.assertEqual(por_nome[alvos["smallest"]["partition"]], min(FIVE_TARGETS))
        self.assertAlmostEqual(
            assemble_corpus.CLASS_TOLERANCE, alvos["tolerance"], places=10
        )

    def test_o_catalogo_declara_exatamente_os_corpos_que_os_dois_lados_medem(self):
        """Por igualdade, e nao por pertinencia.

        Apagar um caso do JSON deixaria os dois lacos de concordancia verdes com uma celula
        de cobertura a menos, dos DOIS lados da fronteira de linguagem, e nada ficaria
        vermelho. O lado TypeScript afirma a mesma lista.
        """
        self.assertEqual(
            [caso["name"] for caso in self.catalogo["cases"]],
            [
                "lote-unico-por-celula",
                "um-componente-por-celula",
                "so-o-maior-componente",
                "so-o-menor-componente",
                "duas-aquisicoes-25-75",
                "misto-com-degenerescencia-humana",
                "corpo-grosso-classes-finas",
                "bordas-inclusivas-47-e-7",
                "forma-medida-da-classe-gerada",
                "ilhas-de-receita-que-passam",
                "misto-com-degenerescencia-mista",
            ],
        )
        # Todo escopo e toda condicao que o catalogo nomeia tem traducao deste lado: um
        # escopo sem marcador passaria pelo laco sem afirmar coisa alguma.
        for caso in self.catalogo["cases"]:
            for violacao in caso["expected"]["breaches"]:
                self.assertIn(violacao["kind"], MARCADOR_DA_RECUSA)
                self.assertIn(violacao["scope"], MARCADOR_DO_ESCOPO)
                self.assertIn(
                    violacao["kind"], self.catalogo["expectedBreachVocabulary"]
                )

    def test_a_ordem_dos_escopos_e_o_corpo_e_depois_cada_classe_presente(self):
        """A ordem em que esta guarda checa os escopos, que e a ordem do relato do outro lado.

        Uma ordem diferente faria os dois lados discordarem sobre QUAL condicao recusa num
        corpo que viola mais de uma, sem que veredito algum mudasse.
        """
        self.assertEqual(assemble_corpus.CORPUS_SCOPE, "corpus")
        self.assertEqual(assemble_corpus.LABEL_REPORT_ORDER, ("human", "ai", "mixed"))
        registros = _linhas_do_caso(
            next(
                caso
                for caso in self.catalogo["cases"]
                if caso["name"] == "corpo-grosso-classes-finas"
            ),
            self.catalogo["generatedStratum"],
        )
        escopos = assemble_corpus.component_fractions_by_scope(registros)
        self.assertEqual([escopo for escopo, _, _ in escopos], ["corpus", "human", "ai"])
        # O denominador de cada escopo, medido: a classe divide pelo TOTAL DA CLASSE.
        self.assertEqual([total for _, total, _ in escopos], [40, 20, 20])

    def _caso(self, nome: str) -> dict:
        return next(c for c in self.catalogo["cases"] if c["name"] == nome)

    def test_a_forma_medida_dos_pools_e_RECUSADA_e_a_de_ilhas_PASSA(self):
        """As duas metades da perna (c), sobre o MESMO par de eixos e a MESMA lista de uniao.

        A forma que os pools produzem — 1170 linhas ai, `promptTemplate` em 641/231/213/85 e
        `generatorVersion` em 493/320/256/99/2 — deixa QUATRO componentes, um por template, e o
        maior vale 54,79 %: recusada pelo ramo do MAIOR, no escopo do corpo e no da classe
        `ai`, que num corpo mono-classe e a mesma comparacao sobre as mesmas linhas. A
        geometria de ILHAS — 20 corridas de versao com dois templates cada — da 40 componentes
        de 10 e passa.

        Sem a primeira a obrigacao nao tem tamanho; sem a segunda ela nao tem prova de ser
        cumprivel. As duas juntas sao o que faz da perna (c) uma decisao e nao uma preferencia.
        """
        medida = self._caso("forma-medida-da-classe-gerada")
        ilhas = self._caso("ilhas-de-receita-que-passam")
        for caso, componentes_esperados in ((medida, 4), (ilhas, 40)):
            with self.subTest(caso=caso["name"]):
                registros = _linhas_do_caso(caso, self.catalogo["generatedStratum"])
                # As corridas declaradas sao as MEDIDAS, e o corpo as realiza.
                for eixo, chave in (
                    ("promptTemplate", "promptTemplateRuns"),
                    ("generatorVersion", "generatorVersionRuns"),
                ):
                    contagem: dict[str, int] = {}
                    for rec in registros:
                        identidade = group_axes.identity_of(rec["groups"][eixo])
                        contagem[identidade] = contagem.get(identidade, 0) + 1
                    self.assertEqual(
                        sorted(contagem.values(), reverse=True),
                        sorted(caso["generatedRecipe"][chave], reverse=True),
                    )
                # SOB A UNIAO DE PRODUCAO, sem mock nenhum: e isso que faz a geometria ser a
                # que o splitter produz e nao a que um passeio contrafactual produziria.
                self.assertEqual(len(componentes(registros)), componentes_esperados)

        # A recusa da forma medida, e os DOIS escopos que o outro lado declara.
        registros = _linhas_do_caso(medida, self.catalogo["generatedStratum"])
        escopos = {
            escopo: fracoes
            for escopo, _total, fracoes in (
                assemble_corpus.component_fractions_by_scope(registros)
            )
        }
        self.assertEqual(escopos["corpus"], escopos["ai"])
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions(registros)
        self.assertIn("maior componente", str(erro.exception))
        self.assertIn("do corpo", str(erro.exception))
        self.assertEqual(
            {v["scope"] for v in medida["expected"]["breaches"]}, {"corpus", "ai"}
        )
        self.assertEqual(
            {v["kind"] for v in medida["expected"]["breaches"]},
            set(MARCADOR_DA_RECUSA),
        )
        # E a de ilhas nao levanta: a guarda aceita o corpo que o plano constroi.
        assert_components_can_fill_five_partitions(
            _linhas_do_caso(ilhas, self.catalogo["generatedStratum"])
        )

    def test_as_tres_pernas_sao_SUB_RELACOES_da_uniao_de_producao(self):
        """Cada perna e medida sobre a uniao MENOS os IMPOSTOS, mais os eixos que ela nomeia.

        Medir a perna do template como `SPLIT_GROUP_KEYS + ("promptTemplate",)` seria NO-OP,
        e as tres pernas relatariam o mesmo histograma — o catalogo continuaria verde
        afirmando uma geometria que nao mede nada. E `promptTemplateOnly` tem de ser
        exactamente o que a PRODUCAO faz, agora que a versao saiu da uniao: a igualdade de
        raiz por raiz e a costura que impede o catalogo de declarar uma geometria que o
        splitter nao produz. `bothRecipeAxes` passa a ser CONTRAFACTUAL, e o que se afirma
        dele e que nunca divide o que a producao une.
        """
        impostos = _lista_do_split_ts("IMPOSED_UNION_AXES")
        base = tuple(k for k in SPLIT_GROUP_KEYS if k not in impostos)
        # Nao vacuo: a base perdeu exactamente os eixos impostos.
        self.assertEqual(len(base) + len(impostos), len(SPLIT_GROUP_KEYS))
        for nome in ("forma-medida-da-classe-gerada", "ilhas-de-receita-que-passam"):
            caso = self._caso(nome)
            registros = _linhas_do_caso(caso, self.catalogo["generatedStratum"])
            declarado = caso["expected"]["recipeUnioned"]
            for perna in ("generatorVersionOnly", "promptTemplateOnly", "bothRecipeAxes"):
                with self.subTest(caso=nome, perna=perna):
                    geometria = declarado[perna]
                    with mock.patch.object(
                        assemble_corpus,
                        "SPLIT_GROUP_KEYS",
                        base + tuple(geometria["axes"]),
                    ):
                        tamanhos = componentes(registros)
                        raizes_da_perna = assemble_corpus.connected_components(registros)
                        recusa = None
                        try:
                            assert_components_can_fill_five_partitions(registros)
                        except UnsplittableCorpus as erro:
                            recusa = str(erro)
                    self.assertEqual(len(tamanhos), geometria["components"])
                    self.assertEqual(
                        sorted(tamanhos.values()), sorted(geometria["histogram"])
                    )
                    # A violacao declarada e a que a guarda de PRODUCAO levanta. A guarda
                    # estoura na PRIMEIRA condicao violada, entao o que se afirma e o
                    # marcador da primeira da lista ORDENADA, mais a ausencia dos marcadores
                    # que nenhuma violacao da perna carrega — sem essa segunda metade, uma
                    # perna que viola duas passaria por prova do ramo errado.
                    violacoes = geometria["breaches"]
                    self.assertEqual(bool(violacoes), recusa is not None)
                    if recusa is not None:
                        self.assertIn(
                            MARCADOR_DA_RECUSA[violacoes[0]["kind"]], recusa
                        )
                        declaradas = {v["kind"] for v in violacoes}
                        for chave, marcador in MARCADOR_DA_RECUSA.items():
                            if chave not in declaradas:
                                self.assertNotIn(marcador, recusa)
                    if perna == "promptTemplateOnly":
                        # A COSTURA: o passeio da perna e o de PRODUCAO, raiz por raiz.
                        self.assertEqual(
                            raizes_da_perna,
                            assemble_corpus.connected_components(registros),
                        )
                    if perna == "bothRecipeAxes":
                        # O CONTRAFACTUAL nunca divide o que a producao une: acrescentar eixo
                        # de uniao so funde. Sem isto o catalogo poderia declarar para esta
                        # perna uma geometria mais FINA que a de producao, que e impossivel.
                        self.assertLessEqual(
                            len(tamanhos),
                            declarado["promptTemplateOnly"]["components"],
                        )
        # Os dois numeros que fixam a GRANULARIDADE, e o que eles dizem: o template sozinho
        # nao cabe (54,79 %) e e a perna que a PRODUCAO toma, e a versao sozinha CABE
        # (42,14 %) — que e a medicao que diz que por a versao na uniao nunca foi o que a
        # granularidade pedia.
        pernas = self._caso("forma-medida-da-classe-gerada")["expected"]["recipeUnioned"]
        self.assertAlmostEqual(
            max(pernas["promptTemplateOnly"]["histogram"]) / 1170, 0.547863, places=6
        )
        self.assertAlmostEqual(
            max(pernas["generatorVersionOnly"]["histogram"]) / 1170, 0.421368, places=6
        )
        self.assertEqual(pernas["generatorVersionOnly"]["breaches"], [])
        # A comparacao com `generatorFamily` fica do lado TS: este materializador emite ONZE
        # eixos e nao inclui a familia. A igualdade version == family que o comentario de
        # `SPLIT_GROUP_KEYS` cita — e que e a razao de a versao ser reportada e nao unida — e
        # medida sobre os POOLS, em `GeneratorVersionIsTheFamilyTests` (test_extractors.py),
        # e nao aqui.
        registros = _linhas_do_caso(
            self._caso("forma-medida-da-classe-gerada"),
            self.catalogo["generatedStratum"],
        )
        self.assertNotIn("generatorFamily", registros[0]["groups"])

    def test_cada_caso_do_catalogo_recebe_o_veredito_declarado(self):
        for caso in self.catalogo["cases"]:
            with self.subTest(caso=caso["name"]):
                registros = _linhas_do_caso(caso, self.catalogo["generatedStratum"])
                esperado = caso["expected"]
                self.assertEqual(len(registros), esperado["recordLines"])

                # As TRES conferencias MEDIDAS contra as DECLARADAS, antes de qualquer
                # veredito: um materializador que divergiu do outro lado fica vermelho aqui,
                # em vez de concordar sobre um corpo que nao e o mesmo. As duas primeiras sao
                # MARGINAIS e um corpo divergido pode acertar as duas — trocar um componente
                # 1H+3A e um 3H+1A por dois 2H+2A preserva os dez tamanhos e os dois totais.
                # A terceira e o CONJUNTO, e e ela que separa esses dois corpos.
                declarado = sorted(
                    corrida["lines"].get("human", 0)
                    + corrida["lines"].get("ai", 0)
                    + corrida["lines"].get("mixed", 0)
                    for celula in caso["cells"]
                    for corrida in celula["components"]
                    for _ in range(corrida["count"])
                )
                self.assertEqual(_histograma(registros), declarado)
                self.assertEqual(_classes(registros), esperado["classLines"])
                self.assertEqual(_conjunto_medido(registros), _conjunto_declarado(caso))

                # Nao vacuo: os dois eixos grossos realmente carregam UM valor por
                # celula e ainda assim nao unem. Linha gerada nao carrega lote de
                # material, entao so as identidades DEFINIDAS contam.
                self.assertEqual(
                    len(_identidades(registros, "domainSource")),
                    esperado["distinctStrata"],
                )
                self.assertEqual(
                    len(_identidades(registros, "sourceMaterialBatch")),
                    esperado["distinctMaterialBatches"],
                )

                violacoes = esperado["breaches"]
                if not violacoes:
                    assert_components_can_fill_five_partitions(registros)
                    continue

                with self.assertRaises(UnsplittableCorpus) as erro:
                    assert_components_can_fill_five_partitions(registros)
                mensagem = str(erro.exception)
                # A guarda estoura na PRIMEIRA condicao violada, entao o que se afirma e
                # a primeira da lista ordenada — condicao E escopo — e a ausencia dos
                # marcadores que nenhuma violacao da lista carrega. Sem essa segunda
                # metade, um corpo que viola duas passaria por prova do ramo errado.
                self.assertIn(MARCADOR_DA_RECUSA[violacoes[0]["kind"]], mensagem)
                self.assertIn(MARCADOR_DO_ESCOPO[violacoes[0]["scope"]], mensagem)
                declaradas = {v["kind"] for v in violacoes}
                for chave, marcador in MARCADOR_DA_RECUSA.items():
                    if chave not in declaradas:
                        self.assertNotIn(marcador, mensagem)
                escopos = {v["scope"] for v in violacoes}
                for chave, marcador in MARCADOR_DO_ESCOPO.items():
                    if chave not in escopos:
                        self.assertNotIn(marcador, mensagem)


def _mistura(sufixo: object) -> dict[str, str]:
    """Os tres slots de mistura de uma ilha de fixture, um por operacao.

    DERIVADO de `MIX_OPERATIONS` e nao digitado: acrescentar uma operacao ao plano tem de
    quebrar as fixtures que declaram menos, em vez de passar por elas.
    """
    return {
        operacao: f"mix-{operacao}-{sufixo}"
        for operacao in assemble_corpus.MIX_OPERATIONS
    }


def _plano(n: int, reservadas: tuple[str, ...] = ()) -> tuple[dict, ...]:
    """Um plano de `n` ilhas UNIFORMES, com as contagens por classe do release.

    As contagens vem de `ISLAND_PLAN_CLASS_LINES` e nao de literais: mover um total do
    release move o que estas geometrias medem, em vez de as deixar medindo o release antigo.
    """
    def ilha(i: int) -> dict:
        nome = f"ilha_{i:02d}"
        return {
            "island": nome,
            "templates": (f"pt-{i}-a", f"pt-{i}-b"),
            "mixingTemplates": _mistura(i),
            "seedBlock": i,
            "lines": {
                classe: total // n
                for classe, total in assemble_corpus.ISLAND_PLAN_CLASS_LINES.items()
            },
            "reserved": nome in reservadas,
        }

    return tuple(ilha(i) for i in range(n))


class OPreflightDeIlhaRecusaAntesDaCota(unittest.TestCase):
    """A guarda que recusa um plano de ILHAS antes de qualquer chamada de provedor.

    `UnsplittableCorpus` ja recusa um corpo cuja classe gerada e um componente, mas recusa em
    `assign_partitions` — depois de a cota estar gasta. O ponto desta unidade e recusar ANTES,
    e o precedente da casa e `frozen_lane`: o `type=` do argparse, exit 2, nada aberto.
    """

    def test_um_plano_que_cruza_e_recusado_antes_de_qualquer_chamada(self):
        """O TESTE QUE MAIS IMPORTA: subprocesso de verdade, no molde de `FrozenLaneEntryTests`.

        Escrito para MORRER se a chamada da guarda sair do driver. Nada aqui importa
        `island_plan` nem chama a asserção diretamente: o que roda e `generate_ai.py` como
        processo, com um plano CRUZADO injetado por variavel de ambiente, e o que se mede e
        `returncode == 2`, o arquivo de saida INEXISTENTE e a RAZAO no stderr. Tirar
        `type=island_plan` do `add_argument` deixa a asserção direta verde e esta vermelha.

        O que este corpo NAO enxerga e um toque no provedor, e o exit 2 e o que o esconde:
        medido, um toque acrescentado como PRIMEIRA instrucao de `main` e embrulhado em
        `try/except Exception: pass` deixa TODAS as assercoes daqui verdes. Nesta pista quem
        separa "recusou" de "recusou ANTES" e o teste in-process que roda `main()` com
        `sys.argv` falsificado e cobra `assert_not_called` de `call_provider` — a mesma
        mutacao morre la.

        O plano cruzado entra por `CLEANFEED_ISLAND_PLAN_CROSS`, lido por um `sitecustomize`
        escrito no diretorio temporario: o subprocesso substitui `ISLAND_PLAN` por um plano
        cuja ULTIMA ilha reusa o template da PRIMEIRA, que e a colisao que um passeio com
        saida antecipada nao veria.
        """
        import subprocess
        import sys
        import tempfile

        script = Path(__file__).with_name("generate_ai.py")
        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            output = temporario / "ai_agy.jsonl"
            sementes = temporario / "humans.jsonl"
            sementes.write_text("", encoding="utf-8")
            # O plano CRUZADO, montado dentro do subprocesso a partir do plano de producao:
            # a ultima ilha recebe os templates da primeira. Um plano digitado aqui mediria
            # outro corpo; este mede o de producao com UMA colisao introduzida.
            (temporario / "sitecustomize.py").write_text(
                "import assemble_corpus as ac\n"
                "plano = [dict(i) for i in ac.ISLAND_PLAN]\n"
                "plano[-1]['templates'] = plano[0]['templates']\n"
                "ac.ISLAND_PLAN = tuple(plano)\n",
                encoding="utf-8",
            )
            ambiente = {
                **os.environ,
                "PYTHONPATH": os.pathsep.join([str(temporario), str(script.parent)]),
            }
            proc = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--provider",
                    "agy",
                    "--island",
                    "ilha_00",
                    "--humans",
                    str(sementes),
                    "--output",
                    str(output),
                ],
                capture_output=True,
                text=True,
                env=ambiente,
                cwd=str(temporario),
            )
            # Nenhum candidato e nenhum lock: as duas condicoes de "nada foi feito" que um
            # subprocesso enxerga. Gasto de cota nao e uma delas.
            self.assertFalse(output.exists())
            self.assertFalse((output.with_name(output.name + ".lock")).exists())
        self.assertEqual(proc.returncode, 2, proc.stderr)
        # A RAZAO, e nao so uma recusa: o eixo que cruzou e as duas ilhas que o partilham.
        self.assertIn("nao particiona o eixo", proc.stderr)
        self.assertIn("template de geracao", proc.stderr)
        self.assertIn("ilha_19", proc.stderr)
        self.assertIn("depois de a cota estar gasta", proc.stderr)

    def test_um_campo_de_mistura_que_nao_e_MAPA_sai_com_exit_2_e_nao_com_traceback(self):
        """O contrato do driver contra um plano MALFORMADO, medido no processo.

        `island_plan` captura `IslandPlanRefused` e mais nada, entao um `mixingTemplates` que
        nao e mapa tinha de virar traceback: `sorted()` sobre chave que nao e str levanta
        `TypeError`, e uma TUPLA dos tres nomes de operacao passava a igualdade de chaves e
        morria em `AttributeError` depois. O que este teste prende e o "exit 2 com a razao", e
        ele morre das duas formas que o reintroduzem: tirando a conferencia de forma, ou
        chamando a guarda das fracoes antes da guarda de particao — medido, a das fracoes
        levanta `TypeError` dentro de `_island_component` sobre o mesmo plano.
        """
        import subprocess
        import tempfile

        script = Path(__file__).with_name("generate_ai.py")
        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            saida = temporario / "ai_agy.jsonl"
            (temporario / "sitecustomize.py").write_bytes(
                b"import assemble_corpus as ac\n"
                b"plano = [dict(i) for i in ac.ISLAND_PLAN]\n"
                b"plano[-1]['mixingTemplates'] = tuple(sorted(ac.MIX_OPERATIONS))\n"
                b"ac.ISLAND_PLAN = tuple(plano)\n"
            )
            proc = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--provider",
                    "agy",
                    "--island",
                    "ilha_00",
                    "--humans",
                    str(temporario / "humans.jsonl"),
                    "--output",
                    str(saida),
                ],
                capture_output=True,
                text=True,
                env={
                    **os.environ,
                    "PYTHONPATH": os.pathsep.join(
                        [str(temporario), str(script.parent)]
                    ),
                },
                cwd=str(temporario),
            )
            self.assertFalse(saida.exists())
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)
        self.assertIn("nao e mapa e sim tuple", proc.stderr)
        self.assertIn("ilha_19", proc.stderr)

    def test_a_pista_de_MISTURA_recusa_no_PARSER_com_exit_2_e_a_razao_no_stderr(self):
        """A MESMA fronteira em `make_mixed.py`, medida no PROCESSO: codigo de saida e razao.

        O que este corpo mede, e so isso: `returncode == 2`, o candidato INEXISTENTE e as
        cadeias da razao no stderr — nada aqui observa um toque no provedor, e a mutacao que
        acrescenta um a `main` sai do processo com 2 do mesmo jeito. O "ANTES de gastar" desta
        pista e o teste in-process ao lado, e os dois medem coisas diferentes: um prende o
        contrato de linha de comando, o outro prende a ORDEM.

        A recusa e do PARSER e nao do modo, e o primeiro caso mede isso passando
        `--from-pairs` sem `--island`: `type=island_plan` roda antes de `main` despachar o
        modo, entao um modo acrescentado depois nasce guardado. O segundo mede a perna que
        nomeia o plano — uma ilha que ele nao declara. Nenhum dos dois pode ser satisfeito pela
        perna do slate, que com o slate de producao nao recusa ilha alguma.

        A perna do SLATE e provada por outros dois corpos: o que MINGUA o slate in-process e o
        que exige a igualdade das sessenta. Um subprocesso nao alcanca nenhum dos dois, porque
        nao ha como lhe passar um slate.
        """
        import subprocess
        import tempfile

        script = Path(__file__).with_name("make_mixed.py")
        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            entrada = temporario / "entrada.jsonl"
            entrada.write_bytes(b"")
            saida = temporario / "mixed_candidates.jsonl"
            de_pares = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--from-pairs",
                    str(entrada),
                    "--output",
                    str(saida),
                ],
                capture_output=True,
                text=True,
            )
            # O candidato nao foi criado — a unica condicao de "nada foi feito" ao alcance de
            # um subprocesso.
            self.assertFalse(saida.exists())
            fora_do_plano = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--generate",
                    "--island",
                    "ilha_99",
                    "--parents",
                    str(entrada),
                    "--output",
                    str(saida),
                ],
                capture_output=True,
                text=True,
            )
            self.assertFalse(saida.exists())
        # O modo que nao gasta cota nenhuma tambem para, e por falta da flag: a exigencia esta
        # no parser, nao no modo.
        self.assertEqual(de_pares.returncode, 2, de_pares.stderr)
        self.assertIn("--island", de_pares.stderr)
        self.assertEqual(fora_do_plano.returncode, 2, fora_do_plano.stderr)
        self.assertNotIn("Traceback", fora_do_plano.stderr)
        self.assertIn("nao esta no plano", fora_do_plano.stderr)
        self.assertIn("ilha_00", fora_do_plano.stderr)

    def test_o_slate_de_MISTURA_serve_as_SESSENTA_e_a_recusa_alcanca_o_que_falta(self):
        """As sessenta identidades do plano SAO as que declaram operacao no slate desta pista.

        Igualdade de conjuntos e nao contagem: qualquer lista de sessenta nomes satisfaria uma
        contagem, e um nome de fora do plano satisfaria as duas se so a inclusao fosse aferida.

        A segunda metade e o que impede a igualdade de passar por vacuidade: com UM nome
        retirado do slate, `island_plan` recusa e NOMEIA o que falta.
        """
        import argparse

        import make_mixed

        do_plano = {
            nome
            for ilha in assemble_corpus.ISLAND_PLAN
            for nome in ilha["mixingTemplates"].values()
        }
        self.assertEqual(
            len(do_plano),
            len(assemble_corpus.MIX_OPERATIONS) * len(assemble_corpus.ISLAND_PLAN),
        )
        com_operacao = {
            nome
            for nome, spec in make_mixed.MIX_TEMPLATES.items()
            if spec["operation"] is not None
        }
        self.assertEqual(com_operacao, do_plano)
        # E a ilha passa o parser: sem esta assercao a igualdade acima ficaria satisfeita
        # por um slate que a quinta perna recusasse por outra razao.
        self.assertEqual(
            make_mixed.island_plan("ilha_00")["island"],
            assemble_corpus.ISLAND_PLAN[0]["island"],
        )
        # A recusa continua tendo entrada que a alcanca, e a razao nomeia o que falta.
        faltante = assemble_corpus.ISLAND_PLAN[0]["mixingTemplates"]["insercao"]
        curto = {
            nome: spec
            for nome, spec in make_mixed.MIX_TEMPLATES.items()
            if nome != faltante
        }
        with mock.patch.object(make_mixed, "MIX_TEMPLATES", curto):
            with self.assertRaises(argparse.ArgumentTypeError) as recusa:
                make_mixed.island_plan("ilha_00")
        self.assertIn("os que faltam sao", str(recusa.exception))
        self.assertIn(faltante, str(recusa.exception))
        self.assertIn("depois de a cota estar gasta", str(recusa.exception))

    def test_a_pista_de_MISTURA_recusa_a_ilha_SEM_tocar_o_provedor(self):
        """O "ANTES de gastar" desta pista, que nao cabe num subprocesso.

        Exit 2, candidato ausente e cadeia no stderr sobrevivem a um toque no provedor —
        medido: um toque acrescentado como PRIMEIRA instrucao de `main` e embrulhado em
        `try/except Exception: pass` deixa o teste de subprocesso acima verde nos dois modos.
        Quem separa "recusou" de "recusou ANTES" e `main()` in-process com `sys.argv`
        falsificado e o `assert_not_called` do funil, no molde da casa.

        O patch mora em `generate_ai` e nao neste modulo porque e de la que `main` importa
        `call_provider` e `call_with_retries`, e o import acontece DENTRO de `main`:
        `patch.object(make_mixed, ...)` nao teria alvo nenhum, porque o nome nao existe neste
        modulo antes de `main` rodar. O que os dois `assert_not_called` cobrem e esse par de
        nomes, e so ele — um toque que chegasse ao provedor por outro caminho ficaria
        invisivel aqui.

        Os DOIS modos, porque a exigencia e do parser e nao do modo, e cada um com a SUA razao
        no stderr para o exit 2 nao ser lido como recusa por qualquer motivo: `--generate`
        recusa pela perna dos tres `mixingTemplates` — com o slate MINGUADO, porque a perna so
        morde quando falta algum —, `--from-pairs` por `--island` ausente, e nenhum dos dois
        pode ter tocado o provedor para descobrir isso.
        """
        import contextlib
        import io
        import tempfile

        import generate_ai
        import make_mixed

        # O patch no modulo de origem so intercepta enquanto este arquivo nao tiver os nomes:
        # um import subido para o topo se ligaria as funcoes REAIS antes do patch, e os dois
        # `assert_not_called` abaixo passariam a medir mocks que ninguem chamaria nunca.
        self.assertFalse(hasattr(make_mixed, "call_provider"))
        self.assertFalse(hasattr(make_mixed, "call_with_retries"))

        ilha = assemble_corpus.ISLAND_PLAN[0]
        # O slate MINGUADO: sem o slot de `insercao` desta ilha a quinta perna morde, e e ela
        # que este caso mede. Com o slate de producao a corrida passa o parser e morre adiante,
        # por falta de chave — o que provaria outra coisa.
        minguado = {
            nome: spec
            for nome, spec in make_mixed.MIX_TEMPLATES.items()
            if nome != ilha["mixingTemplates"]["insercao"]
        }
        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            entrada = temporario / "entrada.jsonl"
            entrada.write_bytes(b"")
            modos = {
                "--generate": (
                    [
                        "--generate",
                        "--island",
                        ilha["island"],
                        "--parents",
                        str(entrada),
                    ],
                    "templates de mistura",
                ),
                "--from-pairs": (
                    ["--from-pairs", str(entrada)],
                    "--island",
                ),
            }
            for modo, (flags, razao) in modos.items():
                with self.subTest(modo=modo):
                    saida = temporario / f"candidatos{modo}.jsonl"
                    argv = ["make_mixed.py", *flags, "--output", str(saida)]
                    erro_padrao = io.StringIO()
                    with mock.patch.object(make_mixed, "MIX_TEMPLATES", minguado):
                        with mock.patch.object(generate_ai, "call_provider") as chamada:
                            with mock.patch.object(
                                generate_ai, "call_with_retries"
                            ) as escada:
                                with mock.patch.object(sys, "argv", argv):
                                    with contextlib.redirect_stderr(erro_padrao):
                                        with self.assertRaises(SystemExit) as saiu:
                                            make_mixed.main()
                    mensagem = erro_padrao.getvalue()
                    self.assertEqual(saiu.exception.code, 2, mensagem)
                    self.assertIn(razao, mensagem)
                    self.assertFalse(saida.exists())
                    chamada.assert_not_called()
                    escada.assert_not_called()

    def test_a_linha_que_a_pista_de_MISTURA_escreve_CARREGA_a_celula_e_nao_a_ilha(self):
        """O que a linha carrega depois de a porta abrir, e o que ela continua a nao carregar.

        A ilha que o parser devolve E lida por `main`: o laco tira dela a identidade de
        mistura da celula, entao a linha carrega `mix-<operacao>-ilha-NN` com `mixOperation` e
        `mixLevel` ao lado. As tres coisas juntas sao o que impede a alegacao falsa: uma
        identidade de slot sem a operacao seria um nome sobre um edit generico, e a operacao
        sem a identidade nao pertenceria a ilha alguma.

        O que a linha NAO carrega e o NOME da ilha, e isso continua a ser uma medicao: a
        pertenca de ilha e reconstruida do bloco de semente do pai (`island_of_seed`), que e
        funcao do id sozinho, entao um campo com o nome seria uma segunda copia capaz de
        divergir dela.
        """
        import contextlib
        import io
        import tempfile

        import generate_ai
        import make_mixed

        ilha = assemble_corpus.ISLAND_PLAN[0]
        celula = assemble_corpus.mix_cell_allocation(ilha["lines"]["mixed"])[0]
        operacao, nivel = celula
        esperada = ilha["mixingTemplates"][operacao]
        (pai_id,) = pais_da_ilha(ilha["island"])
        pai = " ".join(f"palavra{i:02d}" for i in range(60))
        editado = " ".join(
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        )
        # O fixture se confere: fora da faixa mista os dois modos descartam em vez de emitir, e
        # as assercoes ficariam vacuamente verdes sobre uma lista vazia.
        self.assertTrue(
            make_mixed.in_mixed_band(make_mixed.compute_mixture(pai, editado))
        )

        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            pares = temporario / "pares.jsonl"
            pares.write_bytes(
                json.dumps(
                    {
                        "parentId": pai_id,
                        "parentText": pai,
                        "editedText": editado,
                        "promptTemplateId": "mix_edit_v1",
                        "family": "wikipedia",
                        "sourceMaterialBatch": "lote-01",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                + b"\n"
            )
            pais = temporario / "pais.jsonl"
            pais.write_bytes(
                json.dumps(
                    {
                        "id": pai_id,
                        "text": pai,
                        "label": 0,
                        "family": "wikipedia",
                        "sourceMaterialBatch": "lote-01",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                + b"\n"
            )
            de_pares = temporario / "de_pares.jsonl"
            gerada = temporario / "gerada.jsonl"
            # O modo `--from-pairs` importa o que OUTRA pista escreveu: o par nao declara
            # celula, entao a linha grava a ausencia em vez de supor uma geometria.
            modos = {
                "--from-pairs": (
                    ["--from-pairs", str(pares)],
                    de_pares,
                    {
                        "promptTemplateId": "mix_edit_v1",
                        "mixOperation": None,
                        "mixLevel": None,
                    },
                ),
                "--generate": (
                    [
                        "--generate",
                        "--parents",
                        str(pais),
                        "--target",
                        "1",
                        "--sleep",
                        "0",
                    ],
                    gerada,
                    {
                        "promptTemplateId": esperada,
                        "mixOperation": operacao,
                        "mixLevel": nivel,
                    },
                ),
            }
            for modo, (flags, saida, campos) in modos.items():
                with self.subTest(modo=modo):
                    argv = [
                        "make_mixed.py",
                        *flags,
                        "--island",
                        ilha["island"],
                        "--output",
                        str(saida),
                    ]
                    # `main` chama `sys.stdout.reconfigure`, que `io.StringIO` nao tem: o
                    # substituto precisa ser um TextIOWrapper de verdade.
                    registrado = io.TextIOWrapper(
                        io.BytesIO(), encoding="utf-8", newline="\n"
                    )
                    with mock.patch.object(
                        generate_ai, "call_with_retries", return_value=editado
                    ):
                        with mock.patch.dict(
                            os.environ, {"GEMINI_API_KEY": "chave-de-teste"}
                        ):
                            with mock.patch.object(sys, "argv", argv):
                                with contextlib.redirect_stdout(registrado):
                                    make_mixed.main()
                    bruto = saida.read_bytes().decode("utf-8").strip()
                    self.assertEqual(bruto.count("\n"), 0, bruto)
                    linha_escrita = json.loads(bruto)
                    for campo, valor in campos.items():
                        self.assertEqual(linha_escrita[campo], valor)
                    # O NOME da ilha nao e campo da linha, em modo algum.
                    self.assertNotIn(ilha["island"], bruto)
                    # E as identidades dos OUTROS slots nao aparecem: a linha nomeia UMA
                    # operacao, nao as tres que a ilha reserva.
                    for outra, nome in ilha["mixingTemplates"].items():
                        if nome != linha_escrita["promptTemplateId"]:
                            with self.subTest(outra=outra):
                                self.assertNotIn(nome, bruto)

    def _pista_mista_in_process(
        self, editado_cru, pares_extra=(), pai_cru=None, respostas=None
    ):
        """Roda os dois modos de `make_mixed.main()` e devolve as linhas escritas por modo.

        O chassi partilhado: provedor mockado, `GEMINI_API_KEY` falsa, `sys.argv`
        falsificado. O slate NAO e mais mockado — ele serve as sessenta identidades do plano,
        entao a ilha passa o parser com o slate de producao, e mockar aqui esconderia a
        composicao real do prompt.

        `respostas`, quando dado, e a sequencia de respostas do provedor, uma por chamada: e
        assim que um caso exercita o nudge, que precisa de uma primeira resposta fora de banda
        e de uma segunda dentro.
        """
        import contextlib
        import io
        import json as _json
        import tempfile

        import generate_ai
        import make_mixed

        ilha = assemble_corpus.ISLAND_PLAN[0]
        (pai_id,) = pais_da_ilha(ilha["island"])
        pai = pai_cru or " ".join(f"palavra{i:02d}" for i in range(60))
        escritas: dict[str, list[dict]] = {}
        enviados: list[str] = []
        with tempfile.TemporaryDirectory() as bruto:
            temporario = Path(bruto)
            pares = temporario / "pares.jsonl"
            linhas_de_par = [
                {
                    "parentId": pai_id,
                    "parentText": pai,
                    "editedText": editado_cru,
                    "family": "gemini-3.5-flash-lite",
                    "sourceMaterialBatch": "smb_ptwiki_20220301",
                    "promptTemplateId": "mix_edit_v1",
                },
                *pares_extra,
            ]
            pares.write_bytes(
                b"".join(
                    _json.dumps(p, ensure_ascii=False).encode("utf-8") + b"\n"
                    for p in linhas_de_par
                )
            )
            pais = temporario / "pais.jsonl"
            pais.write_bytes(
                _json.dumps(
                    {
                        "id": pai_id,
                        "text": pai,
                        "label": 0,
                        "family": "gemini-3.5-flash-lite",
                        "sourceMaterialBatch": "smb_ptwiki_20220301",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                + b"\n"
            )
            modos = {
                "--from-pairs": (["--from-pairs", str(pares)], temporario / "p.jsonl"),
                "--generate": (
                    ["--generate", "--parents", str(pais), "--target", "1", "--sleep", "0"],
                    temporario / "g.jsonl",
                ),
            }
            for modo, (flags, saida) in modos.items():
                argv = [
                    "make_mixed.py",
                    *flags,
                    "--island",
                    ilha["island"],
                    "--output",
                    str(saida),
                ]
                registrado = io.TextIOWrapper(io.BytesIO(), encoding="utf-8", newline="\n")
                fila = list(respostas) if respostas is not None else None

                def provedor(*a, **k):
                    # `call_with_retries(transport, *args)`: o primeiro argumento e a
                    # funcao de transporte, e o prompt vem depois dela. Guardo TODO argumento
                    # de texto em vez de assumir a posicao, que e o erro que a primeira
                    # versao desta captura cometeu.
                    enviados.extend(x for x in a if isinstance(x, str))
                    if fila is None:
                        return editado_cru
                    return fila.pop(0) if fila else editado_cru

                with mock.patch.object(
                    generate_ai, "call_with_retries", side_effect=provedor
                ):
                    with mock.patch.dict(
                        os.environ, {"GEMINI_API_KEY": "chave-de-teste"}
                    ):
                        with mock.patch.object(sys, "argv", argv):
                            with contextlib.redirect_stdout(registrado):
                                make_mixed.main()
                escritas[modo] = [
                    _json.loads(l)
                    for l in saida.read_bytes().decode("utf-8").splitlines()
                    if l.strip()
                ]
        return pai, escritas, enviados

    def test_a_linha_ESCRITA_e_canonica_nos_dois_modos(self):
        """A guarda que a canonizacao nao tinha: a linha escrita, e nao a funcao.

        MEDIDO antes de existir: reduzir `canonical_text` a identidade deixava a suite do lab
        indistinguivel — 712 passed, 518 subtests, o mesmo numero —, porque nenhum caso afirmava
        o campo `text` da linha e o fixture do caso vizinho e canonico POR CONSTRUCAO
        (`palavra00 palavra01 ...`), onde canonizar nao faz nada. Este fixture e adversarial de
        proposito, e a forma canonica dele e exactamente o fixture do vizinho: corrida de
        espaco entre toda palavra, espaco antes de uma quebra de linha, espacos nas pontas e uma
        combinante em NFD na primeira palavra reescrita.

        As tres coisas que se afirmam da linha, e cada uma morre sob a identidade: o `text` E a
        forma canonica da entrada crua e DIFERENTE dela; os vaos ladrilham o texto ESCRITO de 0
        a `len(text)`; e a `aiFraction` gravada recomputa dos vaos sobre esse mesmo texto — as
        tres derivam de uma cadeia so, que e o que a decisao de 2026-08-19 compra.
        """
        import unicodedata

        import make_mixed

        palavras = [
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        ]
        # A combinante vai DEPOIS de vogal: "0" + U+0301 nao compoe, e o fixture ficaria
        # em NFC sem que a assercao de nao-vacuidade morresse por isso.
        palavras[0] = palavras[0] + "a\u0301"
        cru = (
            "  ".join(palavras[:20])
            + " \n"
            + "  ".join(palavras[20:40])
            + "\n\n\n"
            + "  ".join(palavras[40:])
            + "   "
        )
        canonico = make_mixed.canonical_text(cru)
        # Nao vacuo nas duas pontas: a entrada CARREGA as formas, e a canonica nao.
        self.assertIn("  ", cru)
        self.assertIn(" \n", cru)
        # A quinta transformacao, que o fixture anterior nao exercitava: sem ela o mutante
        # `\n{3,}` -> `\n{4,}` sobrevive, e foi assim que ele foi achado.
        self.assertIn("\n\n\n", cru)
        self.assertFalse(unicodedata.is_normalized("NFC", cru))
        self.assertNotIn("  ", canonico)
        self.assertNotIn(" \n", canonico)
        self.assertNotIn("\n\n\n", canonico)
        self.assertTrue(unicodedata.is_normalized("NFC", canonico))

        pai, escritas, _enviados = self._pista_mista_in_process(cru)
        # A banda julga o par CANONICO: se este fixture caisse fora, os dois modos descartariam
        # e as assercoes abaixo ficariam vacuamente verdes por lista vazia.
        self.assertTrue(
            make_mixed.in_mixed_band(make_mixed.compute_mixture(pai, canonico))
        )
        for modo, linhas in escritas.items():
            with self.subTest(modo=modo):
                self.assertEqual(len(linhas), 1)
                linha = linhas[0]
                self.assertEqual(linha["text"], canonico)
                self.assertNotEqual(linha["text"], cru)
                vaos = linha["mixture"]["spans"]
                self.assertEqual(vaos[0]["start"], 0)
                self.assertEqual(vaos[-1]["end"], len(linha["text"]))
                de_ia = sum(
                    v["end"] - v["start"] for v in vaos if v["origin"] == "ai"
                )
                self.assertAlmostEqual(
                    linha["mixture"]["aiFraction"],
                    de_ia / len(linha["text"]),
                    places=6,
                )

    def test_dois_pares_que_diferem_SO_em_espaco_colidem_no_dedup(self):
        """A colisao e DELIBERADA, e e a consequencia que a decisao de 2026-08-19 aceitou.

        Duas linhas mistas que diferissem apenas em espaco descreveriam o mesmo texto sob dois
        digests, e o dedup da montagem compara por igualdade exacta. Sob a canonizacao as duas
        viram a MESMA cadeia e o dedup guarda uma — o que se afirma aqui e que a colisao e dita,
        nao incidental: sem canonizacao os dois textos diferem e as duas linhas sobrevivem.
        """
        palavras = [
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        ]
        um = " ".join(palavras)
        outro = "  ".join(palavras)
        self.assertNotEqual(um, outro)

        # O segundo par vem de OUTRA ilha de proposito: `--from-pairs` importa o que outra
        # pista escreveu e nao filtra por bloco de semente, e a colisao e sobre o TEXTO.
        primeiro, segundo = pais_da_ilha(
            assemble_corpus.ISLAND_PLAN[0]["island"]
        )[0], pais_da_ilha(assemble_corpus.ISLAND_PLAN[1]["island"])[0]
        _pai, escritas, _enviados = self._pista_mista_in_process(
            um,
            pares_extra=(
                {
                    "parentId": segundo,
                    "parentText": " ".join(f"palavra{i:02d}" for i in range(60)),
                    "editedText": outro,
                    "family": "gemini-3.5-flash-lite",
                    "sourceMaterialBatch": "smb_ptwiki_20220301",
                    "promptTemplateId": "mix_edit_v1",
                },
            ),
        )
        linhas = escritas["--from-pairs"]
        self.assertEqual(len(linhas), 2)
        self.assertEqual(linhas[0]["text"], linhas[1]["text"])
        guardadas = assemble_corpus.dedup(linhas, lambda r: r["text"], set())
        self.assertEqual([r["parentId"] for r in guardadas], [primeiro])

    def test_emit_RECUSA_cadeia_crua_em_vez_de_confiar_no_chamador(self):
        """A invariante de `emit` e conferida NELE, e este caso e o unico adversario dela.

        Ela morava so nos dois sitios de `main`: um chamador novo — ou um teste — podia escrever
        cru sem que nada acusasse, e a linha sairia com vaos indexando um texto que ninguem
        gravou e com a banda decidida sobre outra cadeia. A recusa nomeia qual das duas cadeias
        chegou fora da forma, porque quem a le esta a decidir onde canonizar.
        """
        import io
        import json as _json

        import make_mixed

        pai = " ".join(f"palavra{i:02d}" for i in range(60))
        editado = " ".join(
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        )
        for papel, (pai_arg, editado_arg) in {
            "edited": (pai, editado.replace(" ", "  ", 1)),
            "parent_row['text']": (pai.replace(" ", "  ", 1), editado),
        }.items():
            with self.subTest(papel=papel):
                with self.assertRaises(ValueError) as ctx:
                    make_mixed.emit(
                        io.StringIO(),
                        {
                            "id": "src_pai_0001",
                            "text": pai_arg,
                            "family": "gemini-3.5-flash-lite",
                            "sourceMaterialBatch": "smb_ptwiki_20220301",
                        },
                        editado_arg,
                        provider="gemini",
                        model="gemini-3.5-flash-lite",
                        template_id="mix_edit_v1",
                        mix_operation=None,
                        mix_level=None,
                    )
                self.assertIn(papel, str(ctx.exception))
                self.assertIn("forma canonica", str(ctx.exception))
        # Nao vacuo: com as duas cadeias canonicas o mesmo `emit` escreve.
        destino = io.StringIO()
        make_mixed.emit(
            destino,
            {
                "id": "src_pai_0001",
                "text": pai,
                "family": "gemini-3.5-flash-lite",
                "sourceMaterialBatch": "smb_ptwiki_20220301",
            },
            editado,
            provider="gemini",
            model="gemini-3.5-flash-lite",
            template_id="mix_edit_v1",
            mix_operation=None,
            mix_level=None,
        )
        self.assertEqual(_json.loads(destino.getvalue())["text"], editado)

    def test_o_prompt_sai_da_cadeia_CANONICA_e_nao_da_crua(self):
        """O material ENVIADO e o material COMPARADO sao a mesma cadeia.

        O corte em 6.000 caracteres depende do espacamento, entao com pai cru o prompt e o diff
        podiam divergir na truncagem. Hoje o pool reservado chega canonico — medido, 0 de 2.247
        fora da forma —, e e justamente por isso que so um pai CRU de fixture da entrada a esta
        guarda: sem ela a premissa vira acidente, e ninguem nota quando ela deixar de valer.
        """
        import make_mixed

        cru = "  ".join(f"palavra{i:02d}" for i in range(60)) + "   "
        canonico = make_mixed.canonical_text(cru)
        self.assertNotEqual(cru, canonico)
        editado = " ".join(
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        )
        _pai, _escritas, enviados = self._pista_mista_in_process(editado, pai_cru=cru)
        self.assertTrue(enviados)
        # A juncao, e nao cada argumento: `call_with_retries` recebe tambem o nome do modelo, e
        # exigir o pai em TODO argumento de texto reprovava por causa dele.
        tudo = " ".join(enviados)
        self.assertIn(canonico, tudo)
        self.assertNotIn(cru, tudo)

    def test_um_plano_de_16_ilhas_de_250_passa_a_geometria_e_NAO_atribui(self):
        """A perna 3 nao e zelo: 16x250 passa o preflight e `_plano_de_blocos` a recusa.

        E o corpo que prova que chamar so `assert_components_can_fill_five_partitions` nao
        basta. O caso simetrico esta junto: 3 ilhas de 1880/1880/240 e a borda EXACTA do
        limite maximo — o preflight aceita e a atribuicao nao fecha.
        """
        for n in (16, 18):
            with self.subTest(ilhas=n):
                plano = _plano(n)
                # A geometria PASSA a primeira autoridade, medida e nao suposta.
                registros = [
                    linha
                    for ilha in plano
                    for linha in assemble_corpus._island_component(ilha)
                ]
                assert_components_can_fill_five_partitions(registros)
                # E a segunda a recusa.
                with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
                    assemble_corpus.assert_island_plan_realizes_the_five_fractions(plano)
                self.assertIn("nao cabe inteiro em bloco algum", str(erro.exception))

        # A BORDA: tres ilhas em 1880/1880/240 satisfazem as duas condicoes extremas do
        # preflight e ainda assim nao ha atribuicao — que e o que o docstring do preflight
        # declara nao decidir.
        borda = tuple(
            {
                "island": f"ilha_{i}",
                "templates": (f"pt-{i}",),
                "mixingTemplates": _mistura(i),
                "seedBlock": i,
                "lines": {"human": n, "ai": n, "mixed": n // 2},
                "reserved": False,
            }
            for i, n in enumerate((1880, 1880, 240))
        )
        registros = [
            linha for ilha in borda for linha in assemble_corpus._island_component(ilha)
        ]
        assert_components_can_fill_five_partitions(registros)
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_realizes_the_five_fractions(borda)
        self.assertIn("nao cabe inteiro em bloco algum", str(erro.exception))

    def test_um_plano_de_15_ilhas_atribui_e_erra_cal_A(self):
        """A terceira autoridade: 15 ilhas atribuem e realizam `cal-A` fora da tolerancia.

        Medido: 6,65 % contra um alvo de 10 %. Sem a conferencia das fracoes REALIZADAS este
        plano passaria as duas primeiras pernas, e o corpo montado seria recusado por
        `assert_stamped_corpus_is_splittable` — depois da cota.
        """
        plano = _plano(15)
        registros = [
            linha for ilha in plano for linha in assemble_corpus._island_component(ilha)
        ]
        # As duas primeiras autoridades PASSAM, medidas.
        assert_components_can_fill_five_partitions(registros)
        assemble_corpus._plano_de_blocos(registros, set())
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_realizes_the_five_fractions(plano)
        self.assertIn("fora da tolerancia", str(erro.exception))
        self.assertIn("cal-A", str(erro.exception))

    def test_o_plano_de_producao_passa_as_tres_pernas_e_realiza_as_cinco_fracoes(self):
        """O contraste que da peso aos tres acima: 20 ilhas passam, e realizam EXACTO.

        E a nao vacuidade da guarda inteira: uma guarda que recusasse tudo tambem passaria
        nos tres testes de recusa.
        """
        plano = assemble_corpus.ISLAND_PLAN
        assemble_corpus.assert_island_plan_is_a_partition(plano)
        assemble_corpus.assert_island_plan_realizes_the_five_fractions(plano)
        assemble_corpus.assert_island_plan_leaves_core_in_the_blind_block(plano)
        self.assertEqual(len(plano), 20)
        registros = [
            linha for ilha in plano for linha in assemble_corpus._island_component(ilha)
        ]
        # 20 componentes, um por ilha, e as fracoes EXACTAS nas TRES classes.
        self.assertEqual(len(componentes(registros)), 20)
        atribuido = assemble_corpus._plano_de_blocos(registros, set())
        total: dict[str, int] = {}
        por_bloco: dict[tuple[str, str], int] = {}
        for rec in registros:
            total[rec["label"]] = total.get(rec["label"], 0) + 1
            chave = (atribuido[rec["id"]], rec["label"])
            por_bloco[chave] = por_bloco.get(chave, 0) + 1
        for bloco, alvo in assemble_corpus.BLOCK_FRACTIONS.items():
            for classe in sorted(total):
                with self.subTest(bloco=bloco, classe=classe):
                    self.assertAlmostEqual(
                        por_bloco[(bloco, classe)] / total[classe], alvo, places=10
                    )

    def test_o_plano_NAO_particiona_a_versao_e_o_residuo_esta_MEDIDO(self):
        """O que a decisao de 2026-08-12 PERDE, medido em vez de prometido.

        `generatorVersion` nao esta na uniao e nao e eixo do plano: ilha alguma declara uma
        identidade de versao e `_island_component` nao emite o eixo. O RESIDUO e que a
        CO-LOCACAO de versao nao e modelada, e a forma medida disso e esta: duas linhas
        geradas de ilhas diferentes com a MESMA identidade de versao ficam em componentes
        diferentes, logo podem cair em particoes diferentes. A perna de novidade de gerador e
        a reserva OOD por familia, que e outro mecanismo e tem lista propria.
        """
        for ilha in assemble_corpus.ISLAND_PLAN:
            with self.subTest(ilha=ilha["island"]):
                self.assertNotIn("generatorVersion", ilha)
        linhas = assemble_corpus._island_component(assemble_corpus.ISLAND_PLAN[0])
        self.assertNotIn("generatorVersion", linhas[0]["groups"])
        self.assertNotIn("generatorVersion", SPLIT_GROUP_KEYS)
        duas = [
            linha
            for ilha in assemble_corpus.ISLAND_PLAN[:2]
            for linha in assemble_corpus._island_component(ilha)
        ]
        # Nao vacuo: a identidade e a MESMA nas linhas geradas das duas ilhas, e ha linha
        # gerada nas duas. Se a versao voltasse a unir, os dois componentes viravam um.
        geradas = 0
        for linha in duas:
            if linha["label"] != "human":
                linha["groups"]["generatorVersion"] = group_axes.known("gv-unica")
                geradas += 1
        self.assertEqual(geradas, 600)
        self.assertEqual(len(componentes(duas)), 2)
        self.assertTrue(assemble_corpus.OOD_RESERVED_FAMILIES)

    def test_as_ARESTAS_que_fecham_a_ilha_sao_as_que_o_docstring_declara(self):
        """As quatro medicoes que o docstring de `_island_component` rotula "medido".

        Sao quatro fatos independentes, e nenhum deles e o que a prosa dizia antes (que as
        humanas partilham `author`):

          1. as humanas NAO partilham autor — 200 identidades em 200 linhas;
          2. a cobertura por `humanSeed` depende de `lines["ai"] == lines["human"]`: com metade
             das geradas, as humanas nao nomeadas ficam solitarias;
          3. as geradas agrupam-se por `promptTemplate`, entao DOIS templates sao dois grupos,
             e e a linha MISTA que os liga — e uma mista so nao basta, porque alcanca a humana
             de um grupo apenas;
          4. dar pai de OUTRA ilha a uma mista funde as duas.
        """
        def ilha(**mudanca: object) -> dict:
            base = {
                "island": "ilha_00",
                "templates": ("pt-a", "pt-b"),
                "mixingTemplates": _mistura(0),
                "seedBlock": 0,
                "lines": {"human": 200, "ai": 200, "mixed": 100},
                "reserved": False,
            }
            base.update(mudanca)
            return base

        cheia = assemble_corpus._island_component(ilha())
        autores = {
            group_axes.identity_of(rec["groups"]["author"])
            for rec in cheia
            if rec["label"] == "human"
        }
        self.assertEqual(len(autores), 200)
        self.assertEqual(len(componentes(cheia)), 1)

        # (2) A COBERTURA: 100 geradas sobre 200 humanas deixam 100 humanas solitarias.
        meia = assemble_corpus._island_component(
            ilha(lines={"human": 200, "ai": 100, "mixed": 100})
        )
        tamanhos = componentes(meia)
        self.assertEqual(len(tamanhos), 101)
        self.assertEqual(sorted(tamanhos.values())[-1], 300)
        self.assertEqual(sorted(tamanhos.values())[:100], [1] * 100)

        # (3) A PONTE das mistas, e o limiar dela.
        for mistas, esperado in ((0, 2), (1, 2), (2, 1)):
            with self.subTest(mistas=mistas):
                self.assertEqual(
                    len(
                        componentes(
                            assemble_corpus._island_component(
                                ilha(lines={"human": 200, "ai": 200, "mixed": mistas})
                            )
                        )
                    ),
                    esperado,
                )
        # E com UM template so nao ha ponte a fazer: um grupo, um componente.
        self.assertEqual(
            len(
                componentes(
                    assemble_corpus._island_component(
                        ilha(
                            templates=("pt-a",),
                            lines={"human": 200, "ai": 200, "mixed": 0},
                        )
                    )
                )
            ),
            1,
        )

        # (4) O PAI DE FORA funde as duas ilhas — a razao de (iii).
        duas = [
            linha
            for i in assemble_corpus.ISLAND_PLAN[:2]
            for linha in assemble_corpus._island_component(i)
        ]
        self.assertEqual(len(componentes(duas)), 2)
        alheia = next(
            rec for rec in duas if rec["label"] == "human" and "ilha_01" in rec["id"]
        )
        mista = next(rec for rec in duas if rec["id"].startswith("plano_m_ilha_00"))
        mista["groups"]["derivationRoot"] = group_axes.known(alheia["id"])
        self.assertEqual(len(componentes(duas)), 1)

    def test_a_conferencia_de_particao_percorre_TODAS_as_ilhas_nas_DUAS_ordens(self):
        """O LACO, exercitado nas TRES pernas e em todos os casos.

        Duas coisas de uma vez. Uma colisao por PERNA, e so aquela perna: uma perna apagada do
        laco deixa a sua fixture vermelha, e sem uma fixture por perna duas das tres podiam
        sair e a suite ficava verde. E a colisao esta na ULTIMA ilha e na PRIMEIRA: uma saida
        antecipada aprovaria a primeira ordem e um passeio que so olha a ultima aprovaria a
        segunda.

        O que se afirma e a MENSAGEM e nao a recusa, e para `seedBlock` isso e o que separa as
        duas coisas: colidir um bloco tambem quebra a COBERTURA, entao uma perna de bloco
        apagada do laco continuaria a recusar — pela mensagem errada.
        """
        base = list(_plano(20))
        # O rotulo afirmado e o do EIXO DE REGISTRO, e o CAMPO vem no nome do dono: os dois
        # campos de template escrevem `groups.promptTemplate`, entao uma colisao entre eles
        # tem de ser vista, e e por isso que a mensagem carrega `ilha/campo`.
        for rotulo, campo, valor_de in (
            ("promptTemplate", "templates", lambda i: base[i]["templates"]),
            ("seedBlock", "seedBlock", lambda i: base[i]["seedBlock"]),
            (
                "promptTemplate",
                "mixingTemplates",
                lambda i: base[i]["mixingTemplates"],
            ),
        ):
            colide_na_ultima = list(base)
            colide_na_ultima[-1] = dict(base[-1], **{campo: valor_de(0)})
            colide_na_primeira = list(base)
            colide_na_primeira[0] = dict(base[0], **{campo: valor_de(-1)})
            for ordem, plano in (
                ("colisao na ULTIMA", colide_na_ultima),
                ("colisao na PRIMEIRA", colide_na_primeira),
            ):
                with self.subTest(perna=f"{rotulo}/{campo}", ordem=ordem):
                    with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
                        assemble_corpus.assert_island_plan_is_a_partition(tuple(plano))
                    mensagem = str(erro.exception)
                    self.assertIn(rotulo, mensagem)
                    # O DONO com o campo, e nao o campo solto: a prosa estatica da recusa cita
                    # `templates` e `mixingTemplates`, entao afirmar o campo sozinho passaria
                    # sem o dono carregar coisa alguma.
                    self.assertIn(f"/{campo}", mensagem)

    def test_um_slot_de_mistura_nao_pode_ser_o_template_de_geracao_de_outra_ilha(self):
        """A colisao CRUZADA entre os dois campos que escrevem o MESMO eixo de registro.

        `_island_component` escreve `groups.promptTemplate` = template de geracao nas linhas
        `ai` e = o slot da operacao nas mistas. Um namespace POR CAMPO aprovava um plano cujo
        slot de mistura e o `templates` de outra ilha, e o corpo colapsava com as pernas todas
        verdes — medido, 19 componentes onde o plano declara 20. Nenhuma das outras fixturas
        alcanca este caso: cada uma colide um campo consigo mesmo.
        """
        base = list(_plano(20))
        cruzado = list(base)
        # UM slot de UMA operacao, e nao o dicionario inteiro: e o caso minimo, e e ele que
        # obriga o dono a nomear a operacao para a mensagem continuar diagnostica.
        mistura = dict(base[-1]["mixingTemplates"])
        mistura["concatenacao"] = base[0]["templates"][0]
        cruzado[-1] = dict(base[-1], mixingTemplates=mistura)
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_is_a_partition(tuple(cruzado))
        mensagem = str(erro.exception)
        self.assertIn("promptTemplate", mensagem)
        # Os DOIS DONOS nomeados com o campo de onde o valor veio, que e o que torna a
        # mensagem diagnostica. Afirmar so "templates" e "mixingTemplates" seria satisfeito
        # pela PROSA ESTATICA da recusa, que cita os dois nomes de campo — a carga e o par
        # `ilha/campo`, com a OPERACAO dentro dele: sem ela o dono nao diz qual dos tres
        # slots colidiu, e a recusa deixa de apontar o conserto.
        self.assertIn("ilha_19/mixingTemplates[concatenacao]", mensagem)
        self.assertIn("ilha_00/templates", mensagem)
        # E o corpo que o plano cruzado monta tem MENOS componentes do que ilhas: e a
        # consequencia que a guarda existe para impedir, medida em vez de afirmada.
        registros = [
            linha for ilha in cruzado for linha in assemble_corpus._island_component(ilha)
        ]
        raizes = assemble_corpus.connected_components(registros)
        self.assertEqual(len(set(raizes.values())), len(cruzado) - 1)

    def test_a_particao_confere_COBERTURA_e_nao_so_disjuncao(self):
        """A quarta perna: blocos DISJUNTOS que nao cobrem os buckets de `island_of_seed`.

        Nenhuma perna do laco colide aqui — os vinte blocos sao distintos —, e o plano ainda
        e recusado, porque `island_of_seed` produz os buckets 0..19 e o plano declara 0..18 e
        20. O candidato humano do bucket 19 nao pertence a ilha alguma, e a linha gerada dele
        nao tem ilha.
        """
        plano = list(_plano(20))
        plano[-1] = dict(plano[-1], seedBlock=20)
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_is_a_partition(tuple(plano))
        # A mensagem da COBERTURA, e nao a de uma colisao: e o que fica vermelho se esta
        # conferencia sair e uma perna de disjuncao passar a responder por ela.
        self.assertIn("os blocos de semente do plano sao", str(erro.exception))
        self.assertIn("ha candidato humano sem ilha", str(erro.exception))
        self.assertNotIn("nao particiona o eixo", str(erro.exception))

    def test_a_reserva_deixa_lugar_para_uma_ilha_de_nucleo_no_bloco_cego(self):
        """TRES ilhas reservadas passam, QUATRO nao — e a guarda existente aprovaria quatro.

        `ReserveFillsTheBlindBlock` recusa somente ACIMA do alvo de `test`, entao quatro ilhas
        de 200 cabem exactamente e deixam o bloco cego inteiramente de reserva. O bloco carrega
        DUAS hipoteses, e sem populacao de nucleo a do recall sobre familia vista nao tem
        denominador. O limite e do PLANO, e e este teste que o fixa.
        """
        nomes = tuple(f"ilha_{i:02d}" for i in range(20))
        assemble_corpus.assert_island_plan_leaves_core_in_the_blind_block(
            _plano(20, nomes[-3:])
        )
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_leaves_core_in_the_blind_block(
                _plano(20, nomes[-4:])
            )
        self.assertIn("nao sobra lugar", str(erro.exception))

    def test_o_ALVO_de_geracao_da_reserva_e_conferido_contra_a_capacidade(self):
        """O alvo da reserva era PROSA num comentario, e o numero que a prosa dizia nao cabia.

        `assert_island_plan_leaves_core_in_the_blind_block` confere as LINHAS QUE O PLANO
        ASSENTA. Ela nao confere o alvo de GERACAO da reserva, que vivia so como frase — "a
        reserva e duas familias de 450 linhas cada" — sem constante e sem assercao. Medido:
        a capacidade de `test` em `ai` e 800, a reserva assenta 600 nas tres ilhas reservadas
        e a guarda exige 200 para uma ilha de nucleo, entao o teto da reserva e 600 e
        2 x 450 = 900 NAO CABE. Um alvo inviavel declarado em comentario descobre-se quando o
        corpus nao sela, e ai a cota ja esta gasta.

        Duas pernas, e a segunda e o que faz desta uma guarda: o alvo vigente passa, e um alvo
        acima do teto e RECUSADO com o teto na mensagem.
        """
        teto = assemble_corpus.reserve_line_ceiling()
        familias = assemble_corpus.RATIFIED_RESERVE_FAMILY_COUNT
        alvo = assemble_corpus.RESERVE_LINES_PER_FAMILY

        # O teto e DERIVADO do plano, das fracoes e do piso -- nao digitado.
        total = assemble_corpus.ISLAND_PLAN_CLASS_LINES["ai"]
        capacidade = total - sum(
            round(total * assemble_corpus.CLASS_FRACTIONS[bloco])
            for bloco in assemble_corpus.CLASS_FRACTIONS
        )
        nucleo = min(
            ilha["lines"]["ai"]
            for ilha in assemble_corpus.ISLAND_PLAN
            if not ilha["reserved"]
        )
        self.assertEqual(teto, capacidade - nucleo)

        # O alvo vigente CABE, e cabe com o numero de familias ratificado.
        assemble_corpus.assert_the_reserve_target_fits(alvo, familias)
        self.assertLessEqual(alvo * familias, teto)
        # E fica acima do piso por familia, sem o que as linhas SAEM do corpus.
        self.assertGreaterEqual(alvo, assemble_corpus.HELD_OUT_MINIMUM)

        # O alvo que a prosa declarava e RECUSADO, e a mensagem carrega o teto.
        with self.assertRaises(assemble_corpus.ReserveTargetInfeasible) as erro:
            assemble_corpus.assert_the_reserve_target_fits(450, 2)
        mensagem = str(erro.exception)
        self.assertIn("450", mensagem)
        self.assertIn(str(teto), mensagem)

        # E o piso e conferido tambem: duas familias a 150 caberiam no teto e cada uma ficaria
        # abaixo do piso, e ai `reserved_families_below_the_recall_floor` retira as linhas.
        with self.assertRaises(assemble_corpus.ReserveTargetInfeasible) as erro:
            assemble_corpus.assert_the_reserve_target_fits(150, 2)
        self.assertIn(str(assemble_corpus.HELD_OUT_MINIMUM), str(erro.exception))

        # A FOLGA que o alvo vigente deixa dentro das ilhas reservadas e o que torna o
        # contraste de familia identificavel: sem linha de familia de NUCLEO sob os templates
        # reservados, `seen` e `unseen` nao partilham nenhuma identidade de template e a fatia
        # mede os templates dessas ilhas e nao a familia.
        assentado = sum(
            ilha["lines"]["ai"]
            for ilha in assemble_corpus.ISLAND_PLAN
            if ilha["reserved"]
        )
        controle = assentado - alvo * familias
        self.assertGreater(
            controle,
            0,
            "sem folga nas ilhas reservadas o contraste seen/unseen fica colinear com o "
            "template, e a fatia `generatorExposure` mede o template",
        )
        self.assertEqual(assemble_corpus.reserve_seen_control_lines(), controle)

    def test_a_cobertura_de_modelo_por_ilha_e_CONFERIVEL_antes_de_gastar_cota(self):
        """Modelo e effort sao argumento POR CORRIDA, e nada os cruzava com ilha.

        A consequencia da lacuna nao e estetica: uma familia que aparece numa ilha so fica em
        correspondencia UM-PARA-UM com os templates daquela ilha, e ai `groups.generatorFamily`
        e `groups.promptTemplate` sao o mesmo fator com dois nomes. A reamostragem nao os
        separa, e a emenda que pos a familia em `mixed.levels` estaria a nomear um fator que
        duplica o template.

        Nao se pode ASSERIR nada sobre uma corrida que nao aconteceu, entao o que esta unidade
        entrega e uma MATRIZ CONFERIVEL: quem for gerar declara ilha -> (modelo, effort), e a
        guarda recusa antes da primeira chamada. `MINIMUM_ISLANDS_PER_FAMILY` e a regra, e ela
        e o MINIMO que quebra a colinearidade -- nao uma alegacao de poder.
        """
        regra = assemble_corpus.MINIMUM_ISLANDS_PER_FAMILY
        self.assertGreaterEqual(regra, 2)

        nucleo = [i["island"] for i in assemble_corpus.ISLAND_PLAN if not i["reserved"]]
        reservadas = [i["island"] for i in assemble_corpus.ISLAND_PLAN if i["reserved"]]

        # Uma matriz que espalha dois modelos por todas as ilhas de nucleo PASSA.
        boa = {
            ilha: [("modelo-a", "low"), ("modelo-b", "high")] for ilha in nucleo
        }
        boa.update({ilha: [("modelo-reserva", "low")] for ilha in reservadas})
        assemble_corpus.assert_generation_coverage(boa)

        # Um modelo numa ilha SO e recusado, com o nome dele e a regra na mensagem.
        ma = {ilha: [("modelo-a", "low")] for ilha in nucleo}
        ma[nucleo[0]] = [("modelo-a", "low"), ("modelo-solitario", "low")]
        ma.update({ilha: [("modelo-reserva", "low")] for ilha in reservadas})
        with self.assertRaises(assemble_corpus.CoverageMatrixRefused) as erro:
            assemble_corpus.assert_generation_coverage(ma)
        mensagem = str(erro.exception)
        self.assertIn("modelo-solitario", mensagem)
        self.assertIn(str(regra), mensagem)

        # Uma ilha de nucleo SEM atribuicao e recusada: ela nao produziria linha e a cota da
        # classe nao fecharia, o que hoje se descobre no fim da corrida.
        vazia = {ilha: [("modelo-a", "low"), ("modelo-b", "low")] for ilha in nucleo[1:]}
        vazia.update({ilha: [("modelo-reserva", "low")] for ilha in reservadas})
        with self.assertRaises(assemble_corpus.CoverageMatrixRefused) as erro:
            assemble_corpus.assert_generation_coverage(vazia)
        self.assertIn(nucleo[0], str(erro.exception))

        # A ilha RESERVADA e isenta da regra de duas ilhas -- a reserva mede novidade de
        # familia e vive nas tres reservadas por desenho --, mas ela EXIGE o controle `seen`:
        # sem uma familia de nucleo sob os templates reservados, a fatia mede o template.
        sem_controle = {ilha: [("modelo-a", "low"), ("modelo-b", "low")] for ilha in nucleo}
        sem_controle.update({ilha: [("modelo-reserva", "low")] for ilha in reservadas})
        assemble_corpus.assert_generation_coverage(sem_controle)
        self.assertGreater(assemble_corpus.reserve_seen_control_lines(), 0)

        # Uma ilha que o PLANO nao tem e recusada: uma matriz escrita contra um plano de
        # outra versao aprovaria cobertura que nao existe, e o nome errado e silencioso.
        inventada = {ilha: [("modelo-a", "low"), ("modelo-b", "low")] for ilha in nucleo}
        inventada["ilha_99"] = [("modelo-c", "low")]
        inventada.update({ilha: [("modelo-reserva", "low")] for ilha in reservadas})
        with self.assertRaises(assemble_corpus.CoverageMatrixRefused) as erro:
            assemble_corpus.assert_generation_coverage(inventada)
        self.assertIn("ilha_99", str(erro.exception))

        # E o EFFORT entra na identidade da cobertura: o mesmo modelo em dois efforts numa
        # ilha so continua a ser um modelo numa ilha so, e a guarda nao pode contar dois.
        dois_efforts = {ilha: [("modelo-a", "low"), ("modelo-b", "low")] for ilha in nucleo}
        dois_efforts[nucleo[0]] = [
            ("modelo-a", "low"),
            ("modelo-b", "low"),
            ("modelo-c", "low"),
            ("modelo-c", "high"),
        ]
        dois_efforts.update({ilha: [("modelo-reserva", "low")] for ilha in reservadas})
        with self.assertRaises(assemble_corpus.CoverageMatrixRefused) as erro:
            assemble_corpus.assert_generation_coverage(dois_efforts)
        self.assertIn("modelo-c", str(erro.exception))

    def test_a_cota_mista_de_2000_e_DERIVADA_e_a_alternativa_recusada_e_1600(self):
        """A razao da cota, e ela era prosa: o VALOR foi ratificado e a derivacao nao estava presa.

        Duas condicoes independentes, e 2.000 e a menor cota que fecha as DUAS:

          * o PISO. Os positivos que a coorte de `aiFraction` observada >= 0,50 poe no bloco
            cego sao `cota x fracao_da_coorte x fracao_de_test`. A coorte e 12 das 20 celulas
            (niveis 50/60/75/90 das quatro operacoes menos a excluida), logo 0,60; `test` e o
            resto depois dos quatro blocos, logo 0,20. O produto e 0,12, e o piso
            `criticalRecallPositives` e 200 -- entao a cota minima e 1.667;
          * a ALOCACAO EXACTA. `mix_cell_allocation` e total sobre qualquer cota, mas o resto
            vai para as primeiras celulas: uma cota que nao divide 20 ilhas x 20 celulas
            entrega celulas de tamanhos diferentes. Isso exige multiplo de 400.

        O multiplo de 400 imediatamente abaixo e 1.600, e ele da 192 positivos contra o piso de
        200 -- e essa e a ALTERNATIVA RECUSADA. 1.800 passa o piso com 216 e falha a alocacao
        (4,5 por celula). 2.400 passa as duas e custa 400 linhas geradas por 48 positivos.
        """
        celulas = assemble_corpus.mix_cells()
        na_coorte = sum(1 for _op, nivel in celulas if nivel >= 50)
        fracao_coorte = na_coorte / len(celulas)
        self.assertEqual(len(celulas), 20)
        self.assertEqual(na_coorte, 12)
        self.assertAlmostEqual(fracao_coorte, 0.60)

        cota = assemble_corpus.ISLAND_PLAN_CLASS_LINES["mixed"]
        self.assertEqual(cota, 2_000)
        fracao_test = 1 - sum(
            round(cota * assemble_corpus.CLASS_FRACTIONS[bloco]) / cota
            for bloco in assemble_corpus.CLASS_FRACTIONS
        )
        self.assertAlmostEqual(fracao_test, 0.20)

        piso = 200
        no_cego = cota * fracao_coorte * fracao_test
        self.assertGreaterEqual(no_cego, piso)
        self.assertAlmostEqual(no_cego, 240)

        ilhas = len(assemble_corpus.ISLAND_PLAN)
        passo = ilhas * len(celulas)
        self.assertEqual(passo, 400)
        self.assertEqual(cota % passo, 0)
        por_celula = cota // ilhas // len(celulas)
        self.assertEqual(por_celula, 5)

        # A ALTERNATIVA RECUSADA, medida e nao afirmada: o multiplo de 400 abaixo fica sob o
        # piso. Sem esta perna, "2.000 e o menor" e uma frase sem contra-exemplo.
        abaixo = cota - passo
        self.assertEqual(abaixo, 1_600)
        self.assertLess(abaixo * fracao_coorte * fracao_test, piso)
        # E a que passa o piso mas nao aloca exacto.
        self.assertGreater(1_800 * fracao_coorte * fracao_test, piso)
        self.assertNotEqual(1_800 % passo, 0)
        # E o teto de material nao e o vinculo: os pais admissiveis passam da cota.
        self.assertGreater(2_578, cota)

    def test_a_reserva_e_conferida_em_TODA_classe_e_nao_so_na_ai(self):
        """A recusa vem pela classe `human`, com `ai` e `mixed` cabendo nos seus alvos.

        Em todo plano UNIFORME as tres classes sao proporcionais, entao restringir o laco de
        `assert_island_plan_leaves_core_in_the_blind_block` a `("ai",)` e no-op — e a fixture
        que faltava, a irma da que fixa `assert_island_plan_realizes_the_five_fractions`. Aqui
        a ilha reservada carrega MUITA linha humana e pouca gerada, entao so a perna de
        `human` estoura, e a mensagem e por ela que este teste afirma.
        """
        plano = []
        for indice in range(20):
            reservada = indice == 19
            plano.append(
                {
                    "island": f"ilha_{indice:02d}",
                    "templates": (f"pt-{indice:02d}-a", f"pt-{indice:02d}-b"),
                    "seedBlock": indice,
                    "mixingTemplates": _mistura(f"mt-{indice:02d}"),
                    "reserved": reservada,
                    # A reservada leva 1.900 humanas contra 100 nas outras: `human` estoura o
                    # alvo de `test` e as outras duas classes ficam proporcionais e cabem.
                    "lines": {
                        "human": 1_900 if reservada else 100,
                        "ai": 200,
                        "mixed": 100,
                    },
                }
            )
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_leaves_core_in_the_blind_block(
                tuple(plano)
            )
        mensagem = str(erro.exception)
        self.assertIn("'human'", mensagem)
        # E NAO pelas outras duas: se a mensagem as nomeasse, o laco estaria a estourar por
        # um plano desproporcional em tudo e a fixture nao separaria as classes.
        self.assertNotIn("'ai'", mensagem)
        self.assertNotIn("'mixed'", mensagem)

    def test_as_fracoes_realizadas_sao_conferidas_em_TODA_classe_e_nao_so_na_ai(self):
        """Um plano cujas fracoes de `human` saem da tolerancia enquanto `ai` e `mixed` fecham.

        Em todo plano UNIFORME as tres classes sao proporcionais, entao restringir
        `for classe in sorted(total)` a `("ai",)` e no-op: e a fixture que faltava. Aqui as
        classes nao sao proporcionais — dezanove ilhas de 100 humanas e uma de 1, com 200 ai e
        100 mistas em cada. A distribuicao de ilhas por bloco que faz `ai` fechar exactamente
        (9/1/2/4/4 ilhas) manda a ilha de UMA humana para um bloco so, e `train` realiza
        0,4214 de `human` contra o alvo de 0,45 — fora dos dois pontos.
        """
        plano = tuple(
            {
                "island": f"ilha_{i:02d}",
                "templates": (f"pt-{i}-a", f"pt-{i}-b"),
                "mixingTemplates": _mistura(i),
                "seedBlock": i,
                "lines": {"human": 1 if i == 19 else 100, "ai": 200, "mixed": 100},
                "reserved": False,
            }
            for i in range(20)
        )
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_realizes_the_five_fractions(plano)
        # A CLASSE na mensagem: e o que fica vermelho se o laco voltar a conferir `ai` sozinha,
        # e tambem se ele passar a conferir uma classe que aqui esta DENTRO da tolerancia.
        self.assertIn("train/human realiza 0.4214", str(erro.exception))
        self.assertNotIn("/ai realiza", str(erro.exception))
        self.assertNotIn("/mixed realiza", str(erro.exception))
        # E a outra ponta MEDIDA, sem a qual a fixture nao distingue "o laco cobre `human`" de
        # "este plano e recusado de qualquer jeito": sobre o MESMO corpo, `ai` e `mixed`
        # realizam as cinco fracoes DENTRO da tolerancia.
        registros = [
            linha for ilha in plano for linha in assemble_corpus._island_component(ilha)
        ]
        atribuido = assemble_corpus._plano_de_blocos(registros, set())
        total: dict[str, int] = {}
        realizado: dict[tuple[str, str], int] = {}
        for rec in registros:
            total[rec["label"]] = total.get(rec["label"], 0) + 1
            chave = (atribuido[rec["id"]], rec["label"])
            realizado[chave] = realizado.get(chave, 0) + 1
        for bloco, alvo in assemble_corpus.BLOCK_FRACTIONS.items():
            for classe in ("ai", "mixed"):
                with self.subTest(bloco=bloco, classe=classe):
                    self.assertTrue(
                        assemble_corpus.within_class_tolerance(
                            realizado.get((bloco, classe), 0) / total[classe], alvo
                        )
                    )
        self.assertAlmostEqual(
            realizado[("train", "human")] / total["human"], 0.4214, places=4
        )

    def _corpo_reservavel(self, plano: tuple[dict, ...]) -> tuple[list[dict], set[str]]:
        """As linhas do plano com `generatorFamily`, e o `held_out` das ilhas reservadas.

        `_island_component` NAO emite a familia — ela nao decide conectividade —, e
        `_plano_de_blocos` detecta reserva SO por `identity_of(groups["generatorFamily"])`.
        Sem esta emissao o `held_out` nao casa com linha alguma, ZERO componentes sao
        reservados, e uma medicao da reserva estaria a medir o passeio guloso.

        Uma familia por ilha, que e a condicao sem a qual o `reserved` por ilha do plano nao e
        realizavel: uma familia partilhada por ilha reservada e ilha de nucleo arrastaria a
        segunda para `test`.
        """
        registros: list[dict] = []
        for ilha in plano:
            familia = f"plano_gf_{ilha['island']}"
            for linha in assemble_corpus._island_component(ilha):
                if linha["label"] != "human":
                    linha["groups"]["generatorFamily"] = group_axes.known(familia)
                registros.append(linha)
        held_out = {
            f"plano_gf_{ilha['island']}" for ilha in plano if ilha["reserved"]
        }
        return registros, held_out

    def test_a_guarda_de_PRODUCAO_aceita_quatro_ilhas_reservadas_e_recusa_cinco(self):
        """O RESIDUO da guarda do plano, com a medicao PRESA em vez de afirmada.

        `ReserveFillsTheBlindBlock` recusa somente ACIMA do alvo de `test`, e o alvo de `test`
        e 800 linhas por classe gerada de 4000: quatro ilhas de 200 assentam exactamente 800 e
        PASSAM. E por isso que o limite de tres e do PLANO e nao desta guarda, e e isso que
        `assert_island_plan_leaves_core_in_the_blind_block` existe para impor.

        A medicao so vale se a reserva morder: as linhas levam `generatorFamily` e o `held_out`
        nao e vazio, senao nenhum componente e reservado e as tres chamadas abaixo passariam
        por vacuidade. O que se afirma e a BORDA: aceita em quatro, recusa em cinco.
        """
        nomes = tuple(f"ilha_{i:02d}" for i in range(20))
        for n in (3, 4):
            with self.subTest(reservadas=n):
                plano = _plano(20, nomes[-n:])
                registros, held_out = self._corpo_reservavel(plano)
                self.assertEqual(len(held_out), n)
                blocos = assemble_corpus._plano_de_blocos(registros, held_out)
                # NAO VACUO: as linhas das ilhas RESERVADAS estao TODAS em `test`, e sao
                # 200/200/100 por ilha reservada. Contar o bloco `test` inteiro nao serviria —
                # o passeio guloso enche o resto do alvo com ilha de nucleo.
                assentadas: dict[str, int] = {}
                for ilha in plano:
                    if not ilha["reserved"]:
                        continue
                    for rec in registros:
                        if f"_{ilha['island']}_" not in rec["id"]:
                            continue
                        self.assertEqual(blocos[rec["id"]], "test")
                        assentadas[rec["label"]] = assentadas.get(rec["label"], 0) + 1
                self.assertEqual(
                    assentadas,
                    {"human": 200 * n, "ai": 200 * n, "mixed": 100 * n},
                )
        # E em CINCO ela recusa. As duas pontas juntas fixam a comparacao `>`: uma guarda com
        # `>=` recusaria quatro, e uma com `>` de um alvo maior aceitaria cinco.
        registros, held_out = self._corpo_reservavel(_plano(20, nomes[-5:]))
        self.assertEqual(len(held_out), 5)
        with self.assertRaises(assemble_corpus.ReserveFillsTheBlindBlock) as erro:
            assemble_corpus._plano_de_blocos(registros, held_out)
        self.assertIn("seats 1000 line(s)", str(erro.exception))
        self.assertIn("test block holds 800", str(erro.exception))

    def test_o_piso_de_TEMPLATES_de_um_plano_conforme_e_15_e_o_slate_serve_os_40(self):
        """O preco em TEMPLATES, que e o que o operador paga, medido nas duas pontas.

        O piso de 15 nao e gosto: um plano de 14 ilhas UNIFORMES e recusado pelo preflight
        porque o MENOR componente vale 7,14 % contra o teto de 7 % de `dev`, e 15 passa. E a
        particao exige identidade de template em UMA ilha so, entao N ilhas pedem N templates
        DISTINTOS no minimo — logo 15 e o piso de templates de qualquer plano conforme.

        `ISLAND_PLAN` declara 20 ilhas de dois templates e pede 40, e `RECIPES` serve
        exactamente esses 40 nomes. A recusa continua a ter entrada que a alcanca — a segunda
        metade deste corpo retira UM nome —, e sem ela a igualdade passaria tambem se a guarda
        nunca recusasse nada.
        """
        import argparse

        import generate_ai

        # A ponta de BAIXO, medida: 14 recusado, 15 aceito, e pelo ramo da GRANULARIDADE.
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions(
                [
                    linha
                    for ilha in _plano(14)
                    for linha in assemble_corpus._island_component(ilha)
                ]
            )
        self.assertIn("MENOR componente vale 0.0714", str(erro.exception))
        assert_components_can_fill_five_partitions(
            [
                linha
                for ilha in _plano(15)
                for linha in assemble_corpus._island_component(ilha)
            ]
        )
        # O piso em TEMPLATES sai da PARTICAO: nenhuma identidade em duas ilhas.
        templates = [
            nome
            for ilha in assemble_corpus.ISLAND_PLAN
            for nome in ilha["templates"]
        ]
        self.assertEqual(len(set(templates)), len(templates))
        self.assertEqual(len(templates), 40)
        # E o slate SERVE o plano, por igualdade: os quarenta nomes sao os mesmos.
        self.assertEqual(sorted(generate_ai.RECIPES), sorted(templates))
        # A recusa continua tendo entrada que a alcanca — um slate a que falta UM nome —, e a
        # razao NOMEIA o que falta. Sem esta metade a igualdade acima passaria tambem se a
        # guarda nunca recusasse nada.
        faltante = templates[1]
        curto = {
            nome: spec
            for nome, spec in generate_ai.RECIPES.items()
            if nome != faltante
        }
        with mock.patch.object(generate_ai, "RECIPES", curto):
            with self.assertRaises(argparse.ArgumentTypeError) as recusa:
                generate_ai.island_plan(assemble_corpus.ISLAND_PLAN[0]["island"])
        self.assertIn("os que faltam sao", str(recusa.exception))
        self.assertIn(faltante, str(recusa.exception))

    def test_o_plano_de_producao_e_o_que_a_politica_de_release_declara(self):
        """As contagens por classe do plano SAO `RELEASE_CORPUS_POLICY.counts`, lidas do TS.

        O plano nao le arquivo no import — `generate_ai` importa dele —, entao a igualdade e
        pinada aqui: uma emenda da politica de release que mudasse os totais deixaria o plano
        realizando fracoes de um release que ninguem publica.
        """
        fonte = (BENCHMARK / "dataset-manifest.ts").read_text(encoding="utf-8")
        achado = re.search(
            r"counts:\s*\{\s*human:\s*([\d_]+),\s*ai:\s*([\d_]+),\s*mixed:\s*([\d_]+)\s*\}",
            fonte,
        )
        self.assertIsNotNone(achado)
        declarado = {
            classe: int(valor.replace("_", ""))
            for classe, valor in zip(("human", "ai", "mixed"), achado.groups())
        }
        self.assertEqual(assemble_corpus.ISLAND_PLAN_CLASS_LINES, declarado)
        # E o plano DIVIDE os totais exactamente: um resto silencioso poria linhas fora de
        # ilha alguma, e a soma das ilhas deixaria de ser o release.
        for classe, total in declarado.items():
            with self.subTest(classe=classe):
                self.assertEqual(
                    sum(ilha["lines"][classe] for ilha in assemble_corpus.ISLAND_PLAN),
                    total,
                )

    def test_duas_ilhas_nunca_partilham_uma_semente(self):
        """O bloco de sementes e uma PARTICAO dos candidatos, e a medicao e sobre os pools.

        Medido nos pools em HEAD: 1046 identidades de semente em 1170 linhas, e 116 delas sao
        emparelhadas por linhas de MAIS DE UMA corrida de versao — e so essas arestas fundem as
        cinco corridas numa ilha. Sob o plano, o bucket e funcao do id sozinho, entao o
        cruzamento e ZERO por construcao. O que se afirma e a particao E a nao vacuidade: mais
        de uma ilha recebe semente.
        """
        candidatos = [f"src_wiki_{i:06d}" for i in range(2000)]
        por_ilha: dict[str, int] = {}
        for cid in candidatos:
            ilha = assemble_corpus.island_of_seed(assemble_corpus.ISLAND_PLAN, cid)
            por_ilha[ilha["island"]] = por_ilha.get(ilha["island"], 0) + 1
        # TODA ilha recebe semente: um bucket vazio seria uma corrida sem material.
        self.assertEqual(len(por_ilha), len(assemble_corpus.ISLAND_PLAN))
        self.assertEqual(sum(por_ilha.values()), len(candidatos))
        # E a atribuicao e FUNCAO do id: chamada duas vezes, a mesma ilha.
        for cid in candidatos[:50]:
            with self.subTest(cid=cid):
                self.assertEqual(
                    assemble_corpus.island_of_seed(
                        assemble_corpus.ISLAND_PLAN, cid
                    )["island"],
                    assemble_corpus.island_of_seed(
                        assemble_corpus.ISLAND_PLAN, cid
                    )["island"],
                )

    def test_nenhuma_linha_GRAVADA_leva_template_fora_da_ilha(self):
        """G2 onde a linha NASCE: o driver rodado, e TODAS as linhas que ele escreve lidas.

        `recipe_for_island` chamado diretamente prova o criterio e nada sobre o sitio: o laco
        de `main()` podia voltar a `recipe_for(provider, ...)` e escolher entre as QUATRO
        receitas do slate. Aqui roda `main()` com o transporte falsificado, e o que se afirma e
        o `recipe` de CADA linha gravada — todas elas — mais o artefato de lote, que passou a
        declarar so as receitas da ilha.

        Os templates sao os DA PROPRIA ilha, e nao emprestados: o slate serve os nomes do
        plano agora, e emprestar os de outra ilha faria o plano deixar de particionar o eixo —
        a guarda de particao recusa isso na entrada, medido. O que da entrada a medicao e a
        mutacao do lado oposto: uma escolha que ignore a lista da ilha tira a identidade do
        slate INTEIRO, e ai a identidade escrita nao pertence a esta ilha. O peso nao entra
        nisso — o slate e uniforme, e o picker por provedor que sorteava por peso saiu.
        """
        import json as _json
        import tempfile
        from unittest import mock as _mock

        import generate_ai

        receitas = assemble_corpus.ISLAND_PLAN[0]["templates"]
        for nome in receitas:
            self.assertIn(nome, generate_ai.RECIPES)
        plano = tuple(
            dict(ilha, templates=receitas) if ilha["island"] == "ilha_00" else ilha
            for ilha in assemble_corpus.ISLAND_PLAN
        )
        ilha = next(i for i in plano if i["island"] == "ilha_00")

        sementes: list[dict] = []
        indice = 0
        while len(sementes) < 12:
            cid = f"src_h_{indice:04d}"
            indice += 1
            if assemble_corpus.island_of_seed(plano, cid)["island"] == "ilha_00":
                sementes.append(
                    {
                        "candidateId": cid,
                        "text": " ".join(["palavra"] * 80),
                        "wordCount": 80,
                        "domainSource": "ptwiki",
                    }
                )

        def transporte(url, payload, headers):
            del url, headers
            pedido = payload["contents"][0]["parts"][0]["text"]
            del pedido
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": " ".join(["resposta"] * 80)}]
                        },
                        "finishReason": "STOP",
                    }
                ]
            }

        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            arquivo = temporario / "humans.jsonl"
            arquivo.write_text(
                "".join(_json.dumps(row, ensure_ascii=False) + "\n" for row in sementes),
                encoding="utf-8",
            )
            saida = temporario / "ai_gemini.jsonl"
            argv = [
                "generate_ai.py",
                "--provider", "gemini",
                "--island", "ilha_00",
                "--humans", str(arquivo),
                "--output", str(saida),
                "--per-provider", str(len(sementes)),
                "--sleep", "0",
            ]
            with _mock.patch.object(assemble_corpus, "ISLAND_PLAN", plano):
                with _mock.patch.object(sys, "argv", argv):
                    with _mock.patch.dict(
                        os.environ, {"GEMINI_API_KEY": "chave-de-teste"}
                    ):
                        with _mock.patch.object(
                            generate_ai, "http_json", transporte
                        ):
                            generate_ai.main()
            linhas = [
                _json.loads(linha)
                for linha in saida.read_text(encoding="utf-8").splitlines()
                if linha.strip()
            ]
            lote = _json.loads(
                saida.with_suffix(".batch.json").read_text(encoding="utf-8")
            )

        # NAO VACUO: a corrida escreveu linha, e mais de uma.
        self.assertGreater(len(linhas), 1)
        digestos = {generate_ai.template_digest(nome) for nome in receitas}
        for linha in linhas:
            with self.subTest(linha=linha["candidateId"]):
                self.assertIn(linha["meta"]["recipe"], receitas)
                self.assertIn(linha["meta"]["promptTemplateDigest"], digestos)
        # E o artefato de lote declara SO as receitas da ilha: declarar todas as `RECIPES`
        # fazia o lote nomear receita que a corrida nao usou.
        self.assertEqual(sorted(lote["recipes"]), sorted(receitas))
        self.assertEqual(lote["island"], ilha["island"])

    def test_nenhuma_linha_proposta_leva_template_fora_da_ilha(self):
        """Onde a LINHA NASCE: `recipe_for_island` recusa semente de fora e template de fora.

        O laco percorre TODOS os candidatos e nao uma amostra: uma amostra provaria a ilha nas
        linhas sorteadas e nada sobre a corrida.
        """
        import generate_ai

        plano = _plano(20)
        # Um slate de teste cujos nomes o `RECIPES` de producao serve, porque o que se mede
        # aqui e a RESTRICAO e nao a decisao de coleta.
        receitas = tuple(sorted(generate_ai.RECIPES))[:2]
        ilha = dict(plano[0], templates=receitas)
        outra = dict(plano[1], templates=tuple(sorted(generate_ai.RECIPES))[2:4])
        with mock.patch.object(
            assemble_corpus, "ISLAND_PLAN", (ilha, outra) + plano[2:]
        ):
            propostos: set[str] = set()
            recusados = 0
            for i in range(600):
                cid = f"src_wiki_{i:06d}"
                dono = assemble_corpus.island_of_seed(
                    assemble_corpus.ISLAND_PLAN, cid
                )
                if dono["island"] != ilha["island"]:
                    with self.assertRaises(assemble_corpus.IslandPlanRefused):
                        generate_ai.recipe_for_island(ilha, cid)
                    recusados += 1
                    continue
                propostos.add(generate_ai.recipe_for_island(ilha, cid))
            # NAO VACUO nas duas pontas: houve linha da ilha e houve semente recusada.
            self.assertTrue(propostos)
            self.assertGreater(recusados, 0)
            # E todo template proposto e da ilha.
            self.assertTrue(propostos <= set(receitas), propostos)


class OsTresClustersDeMisturaPorIlha(unittest.TestCase):
    """A forma de tres slots de mistura, e o CRITERIO que fecha a ilha num componente.

    O criterio e **ao menos um** cluster de operacao alcancar as duas metades de template de
    geracao da ilha. Construir todos alcancando e condicao SUFICIENTE deduzida dele, e a
    diferenca e observavel: sem os dois casos VERMELHOS abaixo, um enunciado da condicao
    suficiente passaria por verdadeiro, porque o caso natural satisfaz as duas leituras.

    A paridade e o que faz a atribuicao de pai importar: as linhas `ai` alternam entre os dois
    templates de geracao pelo indice do pai, entao um cluster preso a uma paridade alcanca uma
    metade so.
    """

    def _mistas_com_pais(self, ilha: dict, pai_de) -> list[dict]:
        """A ilha com o pai de cada mista reescrito por `pai_de(indice, humanas)`.

        Pos-edicao em vez de fixture propria de proposito: o corpo continua sendo o que
        `_island_component` produz, entao o que muda entre os casos e SO a atribuicao de pai.
        """
        registros = assemble_corpus._island_component(ilha)
        humanas = [rec["id"] for rec in registros if rec["label"] == "human"]
        mistas = [rec for rec in registros if rec["label"] == "mixed"]
        for indice, rec in enumerate(mistas):
            pai = pai_de(indice, humanas)
            rec["groups"]["humanSeed"] = group_axes.known(pai)
            rec["groups"]["derivationRoot"] = group_axes.known(pai)
        return registros

    def _operacao_de(self, ilha: dict) -> list[str]:
        sequencia: list[str] = []
        por_operacao = assemble_corpus.mix_lines_by_operation(ilha["lines"]["mixed"])
        for operacao, quantas in por_operacao.items():
            sequencia.extend([operacao] * quantas)
        return sequencia

    def test_a_alocacao_por_operacao_e_DERIVADA_e_a_funcao_e_total(self):
        """A aritmetica e a autoridade, e ela fecha em toda cota — nao so na de producao."""
        self.assertEqual(len(assemble_corpus.mix_cells()), 20)
        self.assertEqual(
            assemble_corpus.mix_lines_by_operation(100),
            {"substituicao": 35, "insercao": 30, "concatenacao": 35},
        )
        # TOTAL: a soma fecha com a cota em qualquer tamanho de ilha, porque o plano de 20
        # ilhas e escolha derivada e nao um dado — 15 ilhas dao 133 mistas por ilha.
        for mistas in (0, 1, 2, 100, 125, 133, 940):
            with self.subTest(mistas=mistas):
                self.assertEqual(
                    sum(assemble_corpus.mix_lines_by_operation(mistas).values()), mistas
                )

    def test_as_mistas_de_uma_ilha_carregam_UMA_identidade_por_operacao(self):
        """Tres identidades, com a multiplicidade da alocacao, casadas pelo slot da ilha."""
        ilha = assemble_corpus.ISLAND_PLAN[0]
        registros = assemble_corpus._island_component(ilha)
        contagem: dict[str, int] = {}
        for rec in registros:
            if rec["label"] != "mixed":
                continue
            identidade = group_axes.identity_of(rec["groups"]["promptTemplate"])
            contagem[identidade] = contagem.get(identidade, 0) + 1
        esperado = {
            ilha["mixingTemplates"][operacao]: quantas
            for operacao, quantas in assemble_corpus.mix_lines_by_operation(
                ilha["lines"]["mixed"]
            ).items()
        }
        self.assertEqual(contagem, esperado)
        self.assertEqual(len(contagem), len(assemble_corpus.MIX_OPERATIONS))

    def test_o_plano_de_producao_fecha_cada_ilha_em_UM_componente(self):
        """POR ILHA, nas duas direcoes — o que o nome promete e nao uma contagem.

        A contagem de componentes e o multiconjunto de tamanhos nao dizem isto: medido, um
        corpo com `ilha_05` e `ilha_06` rachadas por paridade e cruzadas uma na outra tem 20
        componentes de 500 linhas com o perfil 200/200/100 de uma ilha natural
        (`test_a_FUSAO_CRUZADA_deixa_a_CONTAGEM_intacta`), e nenhuma das duas ilhas e um
        componente. Entao o que se afirma aqui e a BIJECAO: cada ilha em UMA raiz, e cada raiz
        de UMA ilha.
        """
        por_ilha = [
            (ilha["island"], assemble_corpus._island_component(ilha))
            for ilha in assemble_corpus.ISLAND_PLAN
        ]
        registros = [linha for _, linhas in por_ilha for linha in linhas]
        raizes = connected_components(registros)
        dona: dict[str, list[str]] = {}
        for nome, linhas in por_ilha:
            das_linhas = {raizes[linha["id"]] for linha in linhas}
            with self.subTest(ilha=nome):
                self.assertEqual(len(das_linhas), 1)
                self.assertEqual(len(linhas), 500)
            for raiz in das_linhas:
                dona.setdefault(raiz, []).append(nome)
        # A outra direcao: nenhuma raiz reclamada por duas ilhas. Sem esta metade, `ilha_19`
        # inteira dentro do componente de `ilha_00` passaria — cada ilha continua em UMA raiz.
        partilhadas = {raiz: nomes for raiz, nomes in dona.items() if len(nomes) > 1}
        self.assertEqual(partilhadas, {})
        self.assertEqual(len(dona), len(assemble_corpus.ISLAND_PLAN))

    def test_VERMELHO_pais_de_UMA_PARIDADE_racham_a_ilha(self):
        """O caso que prende a ponte de paridade: sem ela a ilha nao fecha.

        Fica vermelho — isto e, volta a UM componente — se alguma aresta NOVA passar a fechar
        a ilha por outro caminho: um eixo de uniao que `_island_component` emita partilhado
        pela ilha inteira, ou mistas unidas por `source`/`generationBatch`.
        """
        registros = self._mistas_com_pais(
            assemble_corpus.ISLAND_PLAN[0],
            lambda indice, humanas: humanas[(2 * indice) % len(humanas)],
        )
        self.assertEqual(len(componentes(registros)), 2)

    def test_VERMELHO_cobertura_so_COLETIVA_dos_tres_clusters_racha_a_ilha(self):
        """Os tres clusters SOMADOS cobrem as duas paridades, e nenhum individualmente.

        E o caso que refuta a condicao suficiente enunciada como criterio: se bastasse os
        clusters cobrirem as duas metades EM CONJUNTO, este corpo fecharia em um componente.
        Ele mede dois.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        operacoes = self._operacao_de(ilha)
        presa = assemble_corpus.MIX_OPERATIONS[1]

        def pai_de(indice: int, humanas: list[str]) -> str:
            paridade = 1 if operacoes[indice] == presa else 0
            return humanas[(2 * indice + paridade) % len(humanas)]

        registros = self._mistas_com_pais(ilha, pai_de)
        self.assertEqual(len(componentes(registros)), 2)

    def test_VERDE_de_fronteira_UM_cluster_livre_basta(self):
        """A assercao que DISTINGUE o criterio da condicao suficiente.

        Um cluster com pais naturais — as duas paridades — e os outros dois presos cada um a
        uma paridade. Se o criterio fosse "todo cluster alcanca as duas metades", este corpo
        rachava; ele fecha em um. Sem esta assercao, as duas vermelhas acima e o caso natural
        seriam todos consistentes com o enunciado errado.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        operacoes = self._operacao_de(ilha)
        livre = assemble_corpus.MIX_OPERATIONS[0]

        def pai_de(indice: int, humanas: list[str]) -> str:
            if operacoes[indice] == livre:
                return humanas[indice % len(humanas)]
            paridade = 1 if operacoes[indice] == assemble_corpus.MIX_OPERATIONS[1] else 0
            return humanas[(2 * indice + paridade) % len(humanas)]

        registros = self._mistas_com_pais(ilha, pai_de)
        self.assertEqual(len(componentes(registros)), 1)

    @staticmethod
    def _pais_de_uma_paridade(original):
        """`_island_component` com o pai de cada mista trocado por um de indice PAR.

        E a rachadura por paridade aplicada a QUALQUER plano, e nao a um tamanho: as linhas
        `ai` alternam template pelo indice do pai, entao mistas presas a uma paridade deixam a
        outra metade de template sem ponte.
        """

        def parido(ilha: dict) -> list[dict]:
            registros = original(ilha)
            humanas = [rec["id"] for rec in registros if rec["label"] == "human"]
            for indice, rec in enumerate(
                [r for r in registros if r["label"] == "mixed"]
            ):
                pai = humanas[(2 * indice) % len(humanas)]
                rec["groups"]["humanSeed"] = group_axes.known(pai)
                rec["groups"]["derivationRoot"] = group_axes.known(pai)
            return registros

        return parido

    def test_a_guarda_das_cinco_fracoes_RECUSA_a_ilha_RACHADA(self):
        """O RAMO da perna nova, contrafactual: o plano de producao nao o alcanca.

        A guarda julga as fracoes de um corpo modelado. Sem o invariante de ilha ela julgaria
        um corpo cujas ilhas racharam, e o colapso apareceria na montagem, depois da cota.

        DOIS tamanhos de plano, porque 20 ilhas e 40 componentes e um par de numeros que a
        mensagem poderia estar imprimindo por coincidencia: com 10 ilhas a mesma rachadura tem
        de dizer 10 e 20.
        """
        original = assemble_corpus._island_component
        for plano in (assemble_corpus.ISLAND_PLAN, _plano(10)):
            with self.subTest(ilhas=len(plano)):
                with mock.patch.object(
                    assemble_corpus,
                    "_island_component",
                    self._pais_de_uma_paridade(original),
                ):
                    with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
                        assemble_corpus.assert_island_plan_realizes_the_five_fractions(
                            plano
                        )
                mensagem = str(erro.exception)
                # Os DOIS numeros, porque a mensagem tem de dizer o esperado e o medido.
                self.assertIn(f"{len(plano)} ilha(s)", mensagem)
                self.assertIn(f"{2 * len(plano)} componente(s)", mensagem)
                # A DIRECAO medida: a ilha rachou, e nenhuma se fundiu com outra. Afirmar
                # fusao aqui seria afirmar o que este corpo nao tem.
                self.assertIn("nao e UM deles", mensagem)
                self.assertIn(f"{plano[0]['island']!r}: 2", mensagem)
                self.assertNotIn("reclamado por mais de uma ilha", mensagem)
        # E o plano intocado PASSA, para a perna nao ser vacuamente satisfeita.
        assemble_corpus.assert_island_plan_realizes_the_five_fractions(
            assemble_corpus.ISLAND_PLAN
        )

    def test_a_guarda_das_cinco_fracoes_RECUSA_duas_ilhas_no_MESMO_componente(self):
        """A outra direcao, com componentes A MENOS que ilhas e SEM mock nenhum.

        O `mixingTemplates` da ultima ilha igual ao da primeira funde as duas sem rachar
        nenhuma: cada ilha continua em UMA raiz, e a raiz e a mesma. Uma guarda que so
        contasse veria 19 contra 20 e recusaria — mas nomeando a coisa errada; o que a
        mensagem tem de nomear e a raiz partilhada e as duas ilhas que a partilham.
        """
        plano = list(assemble_corpus.ISLAND_PLAN)
        plano[-1] = dict(
            plano[-1], mixingTemplates=plano[0]["mixingTemplates"]
        )
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_realizes_the_five_fractions(tuple(plano))
        mensagem = str(erro.exception)
        self.assertIn(f"{len(plano)} ilha(s)", mensagem)
        self.assertIn(f"{len(plano) - 1} componente(s)", mensagem)
        self.assertIn("reclamado por mais de uma ilha", mensagem)
        self.assertIn(plano[0]["island"], mensagem)
        self.assertIn(plano[-1]["island"], mensagem)
        self.assertNotIn("nao e UM deles", mensagem)
        # As duas guardas sao INDEPENDENTES e nenhuma dispensa a outra: a de particao recusa
        # este plano pela colisao de valor, e nao veria o corpo do teste seguinte.
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as colisao:
            assemble_corpus.assert_island_plan_is_a_partition(tuple(plano))
        self.assertIn("nao particiona o eixo de registro", str(colisao.exception))

    def test_a_FUSAO_CRUZADA_deixa_a_CONTAGEM_intacta_e_a_guarda_recusa(self):
        """O corpo que refuta CONTAR componentes como criterio.

        `ilha_05` e `ilha_06` rachadas por paridade, e cada metade cruzada com a outra ilha
        por UM pai de mista trocado. Medido: 20 componentes, todos de 500 linhas, todos com o
        perfil 200/200/100 de uma ilha natural — a contagem, o multiconjunto de tamanhos e o
        perfil por classe ficam IDENTICOS ao plano intocado, e nenhuma das duas ilhas
        particiona eixo algum. O plano continua passando a guarda de particao, porque o plano
        nao mudou: o que mudou e a atribuicao de pai no corpo modelado.
        """
        original = assemble_corpus._island_component
        rachadas = ("ilha_05", "ilha_06")
        parido = self._pais_de_uma_paridade(original)
        corpo = {
            ilha["island"]: (
                parido(ilha) if ilha["island"] in rachadas else original(ilha)
            )
            for ilha in assemble_corpus.ISLAND_PLAN
        }
        for aqui, la in (rachadas, rachadas[::-1]):
            # A humana de indice IMPAR da outra ilha: e a metade que a paridade deixou sem
            # ponte, e uma aresta de mista para ela cola as duas metades cruzadas.
            impar = [r["id"] for r in corpo[la] if r["label"] == "human"][1]
            mista = [r for r in corpo[aqui] if r["label"] == "mixed"][0]
            mista["groups"]["humanSeed"] = group_axes.known(impar)
            mista["groups"]["derivationRoot"] = group_axes.known(impar)

        registros = [linha for linhas in corpo.values() for linha in linhas]
        tamanhos = componentes(registros)
        self.assertEqual(len(tamanhos), len(assemble_corpus.ISLAND_PLAN))
        self.assertEqual(set(tamanhos.values()), {500})
        # O perfil por classe de cada componente, que e a outra contagem que fica intacta.
        raizes = connected_components(registros)
        perfis: dict[str, dict[str, int]] = {}
        for rec in registros:
            por_classe = perfis.setdefault(raizes[rec["id"]], {})
            por_classe[rec["label"]] = por_classe.get(rec["label"], 0) + 1
        self.assertEqual(
            {tuple(sorted(p.items())) for p in perfis.values()},
            {(("ai", 200), ("human", 200), ("mixed", 100))},
        )
        # E a guarda RECUSA, nomeando as duas ilhas que racharam — o que a contagem nao
        # tinha como dizer.
        assemble_corpus.assert_island_plan_is_a_partition(assemble_corpus.ISLAND_PLAN)
        with mock.patch.object(
            assemble_corpus,
            "_island_component",
            lambda ilha: corpo[ilha["island"]],
        ):
            with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
                assemble_corpus.assert_island_plan_realizes_the_five_fractions(
                    assemble_corpus.ISLAND_PLAN
                )
        mensagem = str(erro.exception)
        self.assertIn(f"{len(assemble_corpus.ISLAND_PLAN)} componente(s)", mensagem)
        for nome in rachadas:
            self.assertIn(f"{nome!r}: 2", mensagem)

    def test_o_vocabulario_de_operacao_e_FECHADO_nas_CINCO_direcoes(self):
        """Chave alienigena, faltante, acentuada, chave que NAO E str, e campo que nao e mapa.

        As duas ultimas nao sao zelo, e cada uma tem a sua armadilha medida. Chave `int`,
        `None` ou tupla faz `sorted()` levantar `TypeError`; um campo que e TUPLA DOS TRES
        NOMES DE OPERACAO passa a igualdade de chaves e morre depois em `AttributeError:
        'tuple' object has no attribute 'items'`. As duas excecoes atravessam o
        `except IslandPlanRefused` de `generate_ai.island_plan`, e o contrato do driver
        degrada de "exit 2 com a razao" para traceback.

        A ilha adulterada e a SEGUNDA do plano, e a mensagem afirma o nome dela e nao o da
        primeira: um passeio com saida antecipada, ou uma mensagem que nomeasse a ilha errada,
        passaria por um caso que adulterasse sempre a primeira.
        """
        base = list(_plano(20))
        alvo, intocada = base[1]["island"], base[0]["island"]
        bons = base[1]["mixingTemplates"]
        acentuada = {("inserção" if k == "insercao" else k): v for k, v in bons.items()}
        for rotulo, mistura, esperados in (
            (
                "alienigena",
                dict(bons, parafrase_total="mix-x"),
                ("sobrando ['parafrase_total']", "faltando []"),
            ),
            (
                "faltante",
                {k: v for k, v in bons.items() if k != "insercao"},
                ("sobrando []", "faltando ['insercao']"),
            ),
            ("acentuada", acentuada, ("sobrando ['inserção']", "faltando ['insercao']")),
            ("chave nao-str", {7: "mix-x", **bons}, ("sobrando [7]", "faltando []")),
            (
                "campo que nao e mapa",
                tuple(sorted(assemble_corpus.MIX_OPERATIONS)),
                ("nao e mapa e sim tuple",),
            ),
        ):
            with self.subTest(caso=rotulo):
                plano = list(base)
                plano[1] = dict(base[1], mixingTemplates=mistura)
                with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
                    assemble_corpus.assert_island_plan_is_a_partition(tuple(plano))
                mensagem = str(erro.exception)
                # A ILHA e o que ESTE caso introduz, porque a recusa tem de apontar onde
                # consertar — e "substituicao" nao serve de pino: a prosa da recusa lista as
                # tres operacoes em todo caso.
                self.assertIn(alvo, mensagem)
                self.assertNotIn(intocada, mensagem)
                for esperado in esperados:
                    self.assertIn(esperado, mensagem)

    def test_o_plano_declara_CEM_identidades_de_template_todas_distintas(self):
        """Cinco por ilha no namespace unico: duas de geracao e uma por operacao."""
        geracao = [t for ilha in assemble_corpus.ISLAND_PLAN for t in ilha["templates"]]
        mistura = [
            t
            for ilha in assemble_corpus.ISLAND_PLAN
            for t in ilha["mixingTemplates"].values()
        ]
        todas = geracao + mistura
        self.assertEqual(len(geracao), 2 * len(assemble_corpus.ISLAND_PLAN))
        self.assertEqual(
            len(mistura),
            len(assemble_corpus.MIX_OPERATIONS) * len(assemble_corpus.ISLAND_PLAN),
        )
        self.assertEqual(len(todas), 100)
        # DISTINTAS, e no mesmo namespace: os dois campos escrevem `groups.promptTemplate`.
        self.assertEqual(len(set(todas)), len(todas))

    def test_a_celula_EXCLUIDA_e_alcancavel_SO_em_pai_curto_e_por_isso_sai(self):
        """A razao de `MIX_CELL_EXCLUDED`, medida com as funcoes de PRODUCAO de `near_dupes`.

        O modelo aqui e uma secao CONTIGUA no meio do pai, com tokens todos distintos, e as
        duas propriedades que ele usa sao AFERIDAS contra a geometria que a pista pede —
        `MIX_GEOMETRIES["insercao"]` —, porque e essa prosa que decide o que o provedor faz. Sem
        as duas assercoes a prosa fica livre: medido, mudar o enxerto para o FIM do texto deixa
        a suite inteira verde, e nessa geometria o par mede 0,8421 em 100 tokens e 0,8494 em
        1200 — os dois ACIMA do limite —, entao a celula deixa de ter os dois lados e a razao
        "proxy de comprimento" que sustenta a exclusao dissolve-se sem nada acusar. As duas
        assercoes sao a mais fraca coisa que separa os dois casos: o LUGAR do enxerto e a
        preservacao INTEGRAL do pai. O resto da redacao continua livre.

        Inserir uma secao que leve o documento ao nivel mais baixo preserva o pai INTEIRO, e o
        par pai/mista fica perto do limite de poda — de que lado depende do COMPRIMENTO do pai.
        Medido: o primeiro cruzamento e em 218 tokens, o sinal so fica monotono a partir de
        232, e entre os dois alterna com o arredondamento do enxerto.

        E e por isso que a celula sai, e a razao NAO e "inalcancavel": ela seria alcancavel so
        para pai curto, entao a celula existiria apenas em documentos pequenos e a OPERACAO
        viraria proxy de COMPRIMENTO — que e eixo de fatia diagnostica declarado. Uma celula
        enviesada por comprimento e pior que uma celula vazia, porque ninguem le o vies.

        Tokens todos distintos, e a suposicao fica dita: texto real repete token, e o efeito
        sobre a contagem de shingles distintos nao e obviamente monotono. `shingles_of` recebe
        LISTA de tokens — passar a string junta mede 5-gramas de CARACTERE, que e outra
        quantidade, e foi o erro que produziu os numeros que este pino corrige.
        """
        import make_mixed
        import near_dupes

        # As duas propriedades do modelo, aferidas contra a geometria que a pista pede: o
        # enxerto entra NO MEIO e o pai fica INTEIRO. Mudar qualquer uma obriga a rederivar
        # esta medicao, e com ela a exclusao de `(insercao, 15)`.
        geometria = make_mixed.MIX_GEOMETRIES["insercao"]
        self.assertIn("no meio do texto", geometria)
        self.assertIn("sem remover nada", geometria)
        self.assertIn(
            ("insercao", min(assemble_corpus.MIX_LEVELS)),
            assemble_corpus.MIX_CELL_EXCLUDED,
        )

        def par(fracao: float, tokens: int, no_fim: bool = False) -> float:
            pai = [f"p{i}" for i in range(tokens)]
            enxerto = [
                f"z{i}" for i in range(round(tokens * fracao / (1.0 - fracao)))
            ]
            meio = tokens // 2
            filho = pai + enxerto if no_fim else pai[:meio] + enxerto + pai[meio:]
            return near_dupes.jaccard(
                near_dupes.shingles_of(pai), near_dupes.shingles_of(filho)
            )

        (operacao, nivel), = assemble_corpus.MIX_CELL_EXCLUDED
        self.assertEqual(operacao, "insercao")
        self.assertEqual(nivel, min(assemble_corpus.MIX_LEVELS))
        fracao = nivel / 100
        limite = near_dupes.JACCARD_THRESHOLD

        # OS DOIS LADOS, que e o que torna a razao "enviesada por comprimento" verificavel:
        # pai curto sobrevive a poda, pai longo e podado.
        self.assertLess(par(fracao, 100), limite)
        self.assertGreaterEqual(par(fracao, 1200), limite)

        # A FRONTEIRA, com os DOIS numeros que a serra tem: o primeiro cruzamento e onde o
        # sinal fica monotono. 218 cai dentro da faixa de comprimento que o corpus mede — as
        # faixas pre-inscritas vao de 50 palavras a 300 e mais —, e e isso que faz o vies
        # morder.
        medido = {tokens: par(fracao, tokens) for tokens in range(100, 320)}
        acima = [tokens for tokens, valor in medido.items() if valor >= limite]
        self.assertEqual(min(acima), 218)
        monotono = next(
            tokens
            for tokens in sorted(medido)
            if all(medido[u] >= limite for u in range(tokens, 320))
        )
        self.assertEqual(monotono, 232)
        # E a ALTERNANCIA entre os dois, que e o que impede ler 218 como "a partir de 218":
        # 219 esta abaixo do limite.
        self.assertLess(medido[219], limite)
        self.assertLess(min(medido[t] for t in range(218, 232)), limite)

        # A celula SEGUINTE da mesma operacao fica sempre abaixo de 0,75, o supremo desta
        # geometria: o comprimento o aproxima POR BAIXO e nunca o alcanca. As duas assercoes
        # em 10.000 tokens sao o que torna falsa a cota antiga de "0,745 no maximo".
        seguinte = sorted(assemble_corpus.MIX_LEVELS)[1] / 100
        for tokens in (100, 218, 232, 1200, 10_000):
            with self.subTest(borda=tokens, celula="seguinte"):
                self.assertLess(par(seguinte, tokens), limite)
        self.assertLess(par(seguinte, 10_000), 0.75)
        self.assertGreater(par(seguinte, 10_000), 0.745)
        self.assertGreater(par(seguinte, 10_000), par(seguinte, 1200))
        # E o supremo abaixo do limite e o que faz a cota valer como razao: um limite de poda
        # menor que 0,75 tornaria a frase falsa sem mover numero nenhum daqui.
        self.assertLess(0.75, limite)

        # A GEOMETRIA suposta, medida na outra forma: anexada ao FIM, a celula excluida fica
        # acima do limite nos DOIS comprimentos, e o "de que lado depende do comprimento"
        # deixa de valer. Relatado, nao promovido a decisao.
        self.assertGreater(par(fracao, 100, no_fim=True), limite)
        self.assertGreater(par(fracao, 1200, no_fim=True), limite)

    def test_a_janela_do_PAI_alargada_nao_admite_poda_de_near_dupe_nova(self):
        """A janela de pais da pista mista e a do extrator, e o que a autoriza e esta medicao.

        Um pai mais longo com a mesma edicao proporcional e MAIS parecido com a mista que
        dele sai, entao alargar o teto do pai poderia por pares novos acima do limite de
        poda — e a poda derruba o pai humano (prioridade `ai` > `mixed` > `human`) e com ele
        a ponte da ilha. A pergunta e se algum cruzamento aparece SO acima do teto antigo.

        Neste MODELO: nenhum cruzamento novo. Todo cruzamento que existe esta na celula de
        nivel mais baixo da `insercao`, que ja sai por `MIX_CELL_EXCLUDED`, e cai em 218
        palavras — abaixo do teto antigo.

        Tres geometrias e nao uma: `insercao` preserva o pai inteiro e por isso maximiza o
        compartilhado, e e a medicao dela que limita as outras duas — mas o limite e
        MEDIDO aqui e nao suposto, porque `substituicao` remove parte do pai e
        `concatenacao` descarta o resto dele, e as duas mudam a UNIAO tambem.

        O QUE ESTE PINO NAO DIZ, e a fronteira e a razao de ele existir separado da medicao
        de material. O modelo tem tokens todos distintos, e `shingles_of` devolve CONJUNTO:
        a multiplicidade desaparece. Texto real repete, entao um enxerto real contribui
        menos shingles distintos do que tokens, a uniao cresce menos e a razao sobe acima
        do que este modelo preve — medido, e nao suposto. No limite em que o enxerto reusa
        as sequencias DO PROPRIO PAI a razao vai a ~1 em qualquer nivel, inclusive nos que
        aqui medem 0,1; isso e ECO, tem teto proprio pre-inscrito e e medido pelo
        `artifact_gate`, e nao e propriedade da janela.

        Logo este pino sozinho NAO autoriza a janela. Ele fixa a geometria e a monotonia em
        comprimento; a autorizacao vem da medicao sobre `reserved.jsonl` registada no
        ESTADO § 5, feita com estas mesmas funcoes de producao sobre as 2.578 linhas reais.
        Palavra e token coincidem neste modelo por construcao, o que NAO vale para texto
        real — e mais uma razao para a autorizacao nao morar aqui.
        """
        import assemble_corpus
        import common
        import near_dupes

        limite = near_dupes.JACCARD_THRESHOLD

        def filho(op: str, n: int, nivel: int) -> list[str]:
            pai = [f"p{i}" for i in range(n)]
            frac = nivel / 100.0
            if op == "insercao":
                enxerto = [f"z{i}" for i in range(round(n * frac / (1.0 - frac)))]
                meio = n // 2
                return pai[:meio] + enxerto + pai[meio:]
            if op == "substituicao":
                g = round(n * frac)
                meio = (n - g) // 2
                return pai[:meio] + [f"z{i}" for i in range(g)] + pai[meio + g:]
            p = n // 2
            return pai[:p] + [f"z{i}" for i in range(round(p * frac / (1.0 - frac)))]

        def par(op: str, n: int, nivel: int) -> float:
            return near_dupes.jaccard(
                near_dupes.shingles_of([f"p{i}" for i in range(n)]),
                near_dupes.shingles_of(filho(op, n, nivel)),
            )

        # O teto antigo era 450 palavras; a janela do extrator vai a `MAXIMUM_WORDS`.
        TETO_ANTIGO = 450
        self.assertLess(TETO_ANTIGO, common.MAXIMUM_WORDS)
        antigos = (common.MINIMUM_WORDS, 100, 218, 232, TETO_ANTIGO)
        novos = (TETO_ANTIGO + 1, 1000, 2500, common.MAXIMUM_WORDS)

        # 1. Nenhuma celula que SOBREVIVE alcanca o limite, em nenhuma das tres geometrias,
        #    em nenhum comprimento que a janela admite.
        for op, nivel in assemble_corpus.mix_cells():
            for n in antigos + novos:
                with self.subTest(celula=(op, nivel), palavras=n):
                    self.assertLess(par(op, n, nivel), limite)

        # 2. E o comprimento aproxima o limite POR BAIXO: o supremo da faixa NOVA e maior
        #    que o da antiga e continua abaixo. Sem esta desigualdade a perna 1 seria
        #    compativel com "o comprimento nao muda nada", e ai medir a faixa nova nao
        #    provaria coisa alguma sobre 5.000 palavras.
        apertada = max(
            assemble_corpus.mix_cells(),
            key=lambda celula: par(celula[0], common.MAXIMUM_WORDS, celula[1]),
        )
        sup_antigo = max(par(*(apertada[0], n, apertada[1])) for n in antigos)
        sup_novo = max(par(*(apertada[0], n, apertada[1])) for n in novos)
        self.assertGreater(sup_novo, sup_antigo)
        self.assertLess(sup_novo, limite)
        self.assertEqual(apertada, ("insercao", sorted(assemble_corpus.MIX_LEVELS)[1]))

        # 3. O caso que a alegacao PROIBE, sem o qual a perna 1 e vacua: a celula excluida
        #    cruza, e cruza DENTRO da janela antiga. E o que torna "nada novo" um fato sobre
        #    a janela e nao sobre um limite frouxo.
        (excluida,) = assemble_corpus.MIX_CELL_EXCLUDED
        cruzam = [
            n
            for n in range(common.MINIMUM_WORDS, TETO_ANTIGO + 1)
            if par(excluida[0], n, excluida[1]) >= limite
        ]
        self.assertEqual(min(cruzam), 218)
        self.assertGreaterEqual(par(*(excluida[0], common.MAXIMUM_WORDS, excluida[1])), limite)

        # 4. A PODA de producao, ponta a ponta, e nao `jaccard` sozinho: a aceitacao usa o
        #    conjunto completo mas o par so chega la se o indice amostrado o encontrar, e
        #    essa deteccao e ela mesma sensivel ao comprimento (1/16 dos shingles acima de
        #    `SAMPLE_MIN_SHINGLES`). Vocabulario PROPRIO por documento: sem ele dois pais de
        #    comprimentos diferentes partilham prefixo e sao near-dupes entre si, e o pool
        #    inteiro colapsa por artefato do fixture.
        AI, MIXED, HUMAN = 0, 1, 2
        del AI

        def pool(op: str, nivel: int) -> list[tuple[str, str, int]]:
            docs = []
            for k, n in enumerate(range(TETO_ANTIGO, common.MAXIMUM_WORDS + 1, 455)):
                pai = [f"d{k}x{i}" for i in range(n)]
                frac = nivel / 100.0
                enxerto = [f"d{k}z{i}" for i in range(round(n * frac / (1.0 - frac)))]
                meio = n // 2
                docs.append((f"human-{k}", " ".join(pai), HUMAN))
                docs.append(
                    (f"mixed-{k}", " ".join(pai[:meio] + enxerto + pai[meio:]), MIXED)
                )
            return docs

        # O CONTROLE: os pais sozinhos nao se podam. Qualquer queda aqui e do fixture.
        so_pais = [doc for doc in pool(*apertada) if doc[0].startswith("human")]
        self.assertGreater(len(so_pais), 1)
        derrubados, _ = near_dupes.prune(so_pais)
        self.assertEqual(derrubados, set())

        # A celula apertada, no pool da janela alargada: nada cai.
        derrubados, estatisticas = near_dupes.prune(pool(*apertada))
        self.assertEqual(derrubados, set())
        # E houve par CANDIDATO: zero candidatos tornaria "nada cai" um fato sobre a
        # deteccao ter falhado, que e outra coisa.
        self.assertGreater(estatisticas["candidate_pairs"], 0)

        # A celula excluida, no MESMO pool: cai o pai humano de todos os comprimentos.
        derrubados, _ = near_dupes.prune(pool(*excluida))
        self.assertEqual(
            sorted(derrubados),
            sorted(doc[0] for doc in pool(*excluida) if doc[0].startswith("human")),
        )

        # O sitio CONSUMIDOR nao e conferido aqui: chamar o ajudante nao prova que `main()`
        # o chama, e essa e a assercao de
        # `test_a_parent_longer_than_the_old_ceiling_reaches_the_RUN`, que dirige `main()`.

    def test_a_medicao_de_material_recusa_os_dois_artefatos_de_fixture(self):
        """As duas armadilhas que fabricam similaridade, e a medicao tem de recusar as duas.

        Elas nao sao hipoteticas: as duas produziram numero publicavel e errado antes de
        serem vistas. (i) Enxerto que e um documento REPETIDO infla tokens sem acrescentar
        shingle distinto, a uniao para de crescer e um nivel 90 mede 0,92 onde o valor
        esperado e ~0,10. (ii) Enxerto tirado do PROPRIO pai leva a razao a ~1 em qualquer
        nivel — que e eco, nao comprimento.

        A guarda contra as duas e a mesma: o fluxo doador e de documentos DISTINTOS e exclui
        o pai sob edicao, e a medicao afere o nivel mais alto contra um teto antes de
        publicar qualquer linha. E o teto e aferido nos DOIS sentidos: um teto que nada
        recusa nao e guarda.
        """
        import measure_mixed_parent_window as medida

        # O fluxo tem de ser grande o bastante para o NIVEL MAIS ALTO: ali o enxerto pede
        # `nivel/(100-nivel)` vezes o pai — nove vezes, em 90 —, e num fluxo curto toda
        # janela desse tamanho contem o pai, e a afericao recusa por falta de material em
        # vez de por similaridade fabricada. Quarenta documentos e o que separa os dois.
        pais = [
            {
                "id": f"pai_{k:03d}",
                "text": " ".join(f"d{k}t{i}" for i in range(300)),
                "label": 0,
                "family": "ptwiki_lead",
            }
            for k in range(40)
        ]

        fluxo = medida.donor_stream(pais)
        donos = medida.donor_owners(pais)

        # (ii) o pai sob edicao nao entra no proprio enxerto — para TODOS os pais e nao um
        # so. Um pai unico com um deslocamento unico passa por acidente de alinhamento:
        # medido, com a exclusao ARRANCADA a janela de `pai_000` no deslocamento 0 continua
        # sem token dele, porque a primeira fatia do fluxo e de outro documento.
        for k in range(len(pais)):
            enxerto = medida.graft_for(fluxo, donos, f"pai_{k:03d}", 60, k * 13)
            self.assertEqual(len(enxerto), 60)
            self.assertFalse(
                [token for token in enxerto if token.startswith(f"d{k}t")],
                f"o enxerto de pai_{k:03d} contem token dele",
            )

        # E a correspondencia posicional dono<->token e conferida, nao suposta: sem ela a
        # exclusao le o dono errado e devolve uma janela COM o pai.
        with self.assertRaises(medida.FixtureFabricatesSimilarity):
            medida.graft_for(fluxo, donos[:-1], "pai_000", 60, 0)

        # (i) o fluxo e de documentos distintos, e por isso quase nao repete shingle.
        import near_dupes

        distintos = len(near_dupes.shingles_of(fluxo)) / len(fluxo)
        self.assertGreater(distintos, 0.9)

        # A AFERICAO do nivel mais alto, nos dois sentidos. Com o fluxo limpo ela passa...
        medida.assert_the_top_level_is_dominated_by_the_graft(pais, fluxo, donos)

        # ...e com um fluxo que e UM documento repetido ela RECUSA. O documento repetido e
        # o ULTIMO pai e nao o primeiro, e a escolha e o que faz esta perna medir o TETO:
        # se o repetido fosse o proprio pai sob afericao, `graft_for` nao acharia janela
        # nenhuma e a recusa viria da falta de material — a mesma excecao pelo motivo
        # errado, e o teto poderia ser posto em 1,01 sem nada ficar vermelho (medido).
        # Repetindo OUTRO documento, a janela existe sempre e o que sobra a recusar e a
        # similaridade que a repeticao fabrica.
        sujo = near_dupes.tokens_of(pais[-1]["text"]) * 40
        donos_sujos = [pais[-1]["id"]] * len(sujo)
        medida.graft_for(sujo, donos_sujos, pais[0]["id"], 2700, 0)
        with self.assertRaises(medida.FixtureFabricatesSimilarity):
            medida.assert_the_top_level_is_dominated_by_the_graft(pais[:1], sujo, donos_sujos)

    def test_a_medicao_publica_TAXA_POR_SORTEIO_e_nao_uma_margem(self):
        """A grandeza e uma cauda, e uma margem sobre o maximo diz o numero errado.

        Medido em `insercao/25` sobre os 2.578 pais: o numero de pares com ao menos um
        enxerto que cruza o limite cresce com o numero de sorteios — 0, 0, 0, 8, 11, 14 para
        K = 1, 2, 4, 8, 12, 24 —, entao o MAXIMO nao converge e "margem = limite − maximo"
        e uma quantidade do K escolhido e nao do corpus. O que nao depende de K e a
        probabilidade POR SORTEIO, e e ela que a medicao publica.

        Por isso cada linha carrega `sorteios` e `sorteios_que_cruzam`, e nao so um maximo:
        com o maximo sozinho, dobrar K muda a conclusao publicada sem nada ficar vermelho.
        """
        import measure_mixed_parent_window as medida

        pais = [
            {
                "id": f"pai_{k:03d}",
                "text": " ".join(f"d{k}t{i}" for i in range(300)),
                "label": 0,
                "family": "ptwiki_lead",
            }
            for k in range(40)
        ]
        tabela = medida.measure(pais, 450)
        self.assertTrue(tabela)

        # O NUMERADOR precisa de um fixture em que algo cruze, e nenhum fixture sintetico
        # que passe a guarda produz cruzamento no limiar de producao — a guarda existe para
        # recusar exactamente o material que o produziria. Entao o limiar entra por
        # parametro, e com ele baixo o mesmo fixture limpo exercita o contador. Sem esta
        # perna, apagar `sorteios_que_cruzam += 1` deixa tudo verde (medido).
        baixa = medida.measure(pais, 450, threshold=0.30)
        self.assertGreater(sum(l["sorteios_que_cruzam"] for l in baixa), 0)
        for linha in baixa:
            with self.subTest(celula=linha["celula"], limiar=0.30):
                # Um par so entra em `cruzam` se ao menos um sorteio dele cruzou.
                if linha["cruzam"]:
                    self.assertGreater(linha["sorteios_que_cruzam"], 0)
                else:
                    self.assertEqual(linha["sorteios_que_cruzam"], 0)
        # E o limiar de producao continua o padrao: baixar o limiar tem de achar MAIS.
        self.assertGreaterEqual(
            sum(l["sorteios_que_cruzam"] for l in baixa),
            sum(l["sorteios_que_cruzam"] for l in tabela),
        )
        for linha in tabela:
            with self.subTest(celula=linha["celula"]):
                # O denominador e explicito: sem ele a contagem de cruzamentos nao e taxa.
                self.assertEqual(linha["sorteios"], len(pais) * medida.GRAFTS_PER_PAIR)
                self.assertLessEqual(linha["sorteios_que_cruzam"], linha["sorteios"])
                # E os dois numeros sao coerentes entre si: um par que cruza precisa de ao
                # menos um sorteio que cruze, e cada par contribui no maximo K sorteios.
                self.assertLessEqual(
                    len(linha["cruzam"]), linha["sorteios_que_cruzam"]
                )
                self.assertLessEqual(
                    linha["sorteios_que_cruzam"],
                    max(1, len(linha["cruzam"])) * medida.GRAFTS_PER_PAIR,
                )

    def test_o_teto_da_afericao_e_derivado_e_a_amostra_nao_e_de_um_enxerto_so(self):
        """As duas propriedades que separam esta medicao de um literal nu com uma amostra.

        O TETO: `TOP_LEVEL_CEILING` nao pode ser digitado. No nivel mais alto o enxerto ocupa
        `nivel` % do texto final, entao o supremo do modelo e `1 - nivel/100`, e o teto e um
        multiplo declarado dele — logo ele se move quando `MIX_LEVELS` se mover. Um numero
        digitado sobrevive a uma mudanca de nivel e passa a aferir contra a geometria errada,
        que e exactamente o defeito do teto de 450 palavras que esta unidade removeu.

        A AMOSTRA: um enxerto por par mede o maximo de UM sorteio e nao o pior caso. Medido
        sobre os 2.578 pais reais em `substituicao/15`, passar de 1 para 12 enxertos por par
        move o maximo de 0,8016 para 0,8080 — a margem cai de 0,0184 para 0,0120 —, entao um
        sorteio unico PUBLICA margem larga demais.
        """
        import assemble_corpus
        import measure_mixed_parent_window as medida

        nivel = max(assemble_corpus.MIX_LEVELS)
        supremo = 1.0 - nivel / 100.0
        self.assertEqual(
            medida.top_level_ceiling(), medida.TOP_LEVEL_HEADROOM * supremo
        )
        # E ele SEGUE os niveis: com um nivel mais alto o supremo encolhe e o teto com ele.
        with mock.patch.object(assemble_corpus, "MIX_LEVELS", (15, 25, 95)):
            self.assertAlmostEqual(
                medida.top_level_ceiling(), medida.TOP_LEVEL_HEADROOM * 0.05
            )

        # O teto fica ACIMA do maximo honesto medido em material e ABAIXO dos dois valores
        # que os fixtures fabricaram, e sem os dois lados ele nao afere nada.
        self.assertGreater(medida.top_level_ceiling(), 0.1360)
        self.assertLess(medida.top_level_ceiling(), 0.92)

        # A amostra e de mais de um enxerto por par, e o numero e nomeado.
        self.assertGreater(medida.GRAFTS_PER_PAIR, 1)

    def test_o_slate_com_receitas_de_BYTES_IDENTICOS_e_recusado_antes_da_cota(self):
        """A particao de ilha e sobre identidade, e a identidade prefixa o NOME da receita.

        Dois nomes servindo o mesmo texto produzem identidades distintas, o grafo continua
        particionado, e a independencia de template que o split modela fica falsa. Cem prompts
        escritos por copia-e-ajuste passariam todas as outras pernas.

        E o que prova o ANTES e o ENTRY POINT: `main()` com `sys.argv` falsificado, no molde
        in-process da casa. Chamar `island_plan` direto mede a funcao e nada sobre a ordem —
        ficaria verde com a chamada da guarda depois da geracao. As duas assercoes que separam
        "recusou" de "recusou ANTES" sao os `assert_not_called` de `call_provider`, funil unico
        das lanes que este script dirige, e de `harness_version`, o primeiro toque no binario.
        """
        import contextlib
        import io
        import tempfile

        import generate_ai

        ilha = assemble_corpus.ISLAND_PLAN[0]
        mesmo_texto = generate_ai.RECIPES[ilha["templates"][0]]["template"]
        gemeas = {
            nome: {"weight": 1, "template": mesmo_texto} for nome in ilha["templates"]
        }
        erro_padrao = io.StringIO()
        with tempfile.TemporaryDirectory() as raw:
            temporario = Path(raw)
            saida = temporario / "ai_agy.jsonl"
            argv = [
                "generate_ai.py",
                "--provider",
                "agy",
                "--island",
                ilha["island"],
                "--humans",
                str(temporario / "humans.jsonl"),
                "--output",
                str(saida),
            ]
            with mock.patch.object(generate_ai, "RECIPES", gemeas):
                with mock.patch.object(generate_ai, "call_provider") as chamada:
                    with mock.patch.object(generate_ai, "harness_version") as versao:
                        with mock.patch.object(sys, "argv", argv):
                            with contextlib.redirect_stderr(erro_padrao):
                                with self.assertRaises(SystemExit) as saiu:
                                    generate_ai.main()
            # Nada foi aberto, nada foi escrito, nada foi gasto.
            self.assertFalse(saida.exists())
            self.assertFalse(saida.with_name(saida.name + ".lock").exists())
        self.assertEqual(saiu.exception.code, 2)
        chamada.assert_not_called()
        versao.assert_not_called()
        mensagem = erro_padrao.getvalue()
        self.assertIn("bytes identicos", mensagem)
        # Os NOMES que colidem, porque a recusa tem de dizer quais reescrever.
        for nome in ilha["templates"]:
            self.assertIn(nome, mensagem)
        # E o slate de hoje PASSA a perna, para ela nao ser vacuamente satisfeita.
        distintos = {
            generate_ai.template_digest(nome) for nome in generate_ai.RECIPES
        }
        self.assertEqual(len(distintos), len(generate_ai.RECIPES))


class ABandaMistaEDerivadaDosNiveis(unittest.TestCase):
    """A banda de cada nivel sai de `MIX_LEVELS`, e a regra reproduz a unica ratificada.

    Sem esta igualdade a regra do ponto medio e uma escolha de quem a escreveu: qualquer
    largura particionaria os sete niveis, e o teste ficaria verde sobre uma tolerancia que
    politica alguma declarou. A banda de v4 — fechada por baixo em [0,50-0,55], § 3.3 do
    ESTADO — e o que a fixa, porque `midpoint(50, 60)` e 55.
    """

    def test_a_banda_de_v4_e_a_ratificada(self):
        import make_mixed

        por_nivel = {nivel: (piso, teto) for nivel, piso, teto in make_mixed.mixed_bands()}
        self.assertEqual(por_nivel[50], (0.50, 0.55))

    def test_as_bandas_particionam_a_curva_sem_lacuna_e_sem_sobreposicao(self):
        import make_mixed

        bandas = make_mixed.mixed_bands()
        self.assertEqual([nivel for nivel, _, _ in bandas], list(assemble_corpus.MIX_LEVELS))
        for (_, _, teto), (_, piso_seguinte, _) in zip(bandas, bandas[1:]):
            self.assertLessEqual(teto, piso_seguinte)
        self.assertEqual(bandas[-1][2], 1.0)

    def test_a_curva_RATIFICADA_inteira_e_admitida_e_o_que_nenhum_nivel_pede_nao_e(self):
        import make_mixed

        # A metade que a banda unica de antes reprovava: v6 e v7 sao a curva, nao excecao.
        for nivel in assemble_corpus.MIX_LEVELS:
            with self.subTest(nivel=nivel):
                self.assertEqual(
                    make_mixed.mixed_level_of({"aiFraction": nivel / 100}), nivel
                )
        # E a outra metade: fracao que nivel algum reivindica nao entra. 0,05 e 0,14 entravam.
        for fracao in (0.04, 0.05, 0.14, 0.55, 0.70, 1.0):
            with self.subTest(fracao=fracao):
                self.assertIsNone(make_mixed.mixed_level_of({"aiFraction": fracao}))

SENTINELA_DO_PROMPT = "=== TEXTO ==="


def prompts_de(enviados: list[str]) -> list[str]:
    """Os prompts entre os argumentos de texto que o funil do provedor recebeu.

    `call_with_retries` recebe tambem o nome da lane e o do modelo, entao contar argumentos
    contaria tres por chamada. A sentinela e a marca do corpo do prompt, e quem usa esta
    funcao afirma que a lista nao esta vazia — sem isso, um dia em que a composicao deixasse
    de a conter tornaria toda assercao sobre prompts vacuamente verde.
    """
    return [x for x in enviados if SENTINELA_DO_PROMPT in x]


class APistaMistaRealizaAsTresOperacoes(unittest.TestCase):
    """O slate de sessenta, o laco por CELULA e a celula gravada na linha.

    As tres coisas entram juntas porque cada uma sozinha e um dano: as sessenta identidades
    sem o laco abrem a porta pre-cota com o escritor incapaz de dizer que operacao a linha
    realizou; o laco sem as identidades estoura no `KeyError` do slate; e a celula nao gravada
    deixa a curva sem chave, porque chavear pela fracao obtida daria uma chave por linha.
    """

    def _gerar(
        self,
        *,
        ilha=None,
        pais=None,
        respostas=None,
        target=100,
        nudge_retries=1,
        texto_do_pai=None,
        passos=None,
    ):
        """Roda `make_mixed.main() --generate` in-process; devolve (linhas, prompts).

        `pais` sao os ids na ordem em que entram no arquivo, e essa ordem E a que decide a
        celula: com uma familia so, `interleave_by_family` preserva a ordem do arquivo, entao
        o pai da posicao `i` recebe `mix_cell_allocation(...)[i]`.

        `passos` e uma lista de `--target`, uma corrida por elemento, TODAS contra o mesmo
        `--output`: e o unico jeito de a segunda corrida ver `already_done` povoado, que e o
        estado em que a estabilidade de celula sob retomada se mede.
        """
        import contextlib
        import io
        import tempfile

        import generate_ai
        import make_mixed

        ilha = ilha or assemble_corpus.ISLAND_PLAN[0]
        pais = pais or pais_da_ilha(ilha["island"], ilha["lines"]["mixed"])
        texto = texto_do_pai or " ".join(f"palavra{i:02d}" for i in range(60))
        enviados: list[str] = []
        with tempfile.TemporaryDirectory() as bruto:
            temporario = Path(bruto)
            arquivo = temporario / "pais.jsonl"
            arquivo.write_bytes(
                b"".join(
                    json.dumps(
                        {
                            "id": pai_id,
                            "text": texto,
                            "label": 0,
                            "family": "ptwiki_lead",
                            "sourceMaterialBatch": "smb_ptwiki_20220301",
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                    + b"\n"
                    for pai_id in pais
                )
            )
            saida = temporario / "gerada.jsonl"
            fila = list(respostas) if respostas is not None else None
            padrao = " ".join(
                (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
            )

            def provedor(*a, **k):
                enviados.extend(x for x in a if isinstance(x, str))
                if fila is None:
                    return padrao
                return fila.pop(0) if fila else padrao

            for alvo in passos or [target]:
                argv = [
                    "make_mixed.py",
                    "--generate",
                    "--island",
                    ilha["island"],
                    "--parents",
                    str(arquivo),
                    "--output",
                    str(saida),
                    "--target",
                    str(alvo),
                    "--sleep",
                    "0",
                    "--nudge-retries",
                    str(nudge_retries),
                ]
                registrado = io.TextIOWrapper(
                    io.BytesIO(), encoding="utf-8", newline="\n"
                )
                with mock.patch.object(
                    generate_ai, "call_with_retries", side_effect=provedor
                ):
                    with mock.patch.dict(
                        os.environ, {"GEMINI_API_KEY": "chave-de-teste"}
                    ):
                        with mock.patch.object(sys, "argv", argv):
                            with contextlib.redirect_stdout(registrado):
                                make_mixed.main()
            linhas = [
                json.loads(l)
                for l in saida.read_bytes().decode("utf-8").splitlines()
                if l.strip()
            ]
        return linhas, prompts_de(enviados)

    def test_o_slate_misto_compoe_as_TRES_coordenadas_e_os_digestos_sao_DISTINTOS(self):
        """Identidade E o digest dos bytes, entao a composicao tem de separar as sessenta.

        Sessenta nomes sobre corpos repetidos satisfariam a conferencia do plano por NOME e
        mentiriam. A assercao e a bijecao nome -> digesto sobre o slate INTEIRO, e ela morre
        se qualquer uma das tres coordenadas sair da composicao: sem a operacao os tres slots
        de uma ilha colidem, e sem a intencao ou o registro colidem as vinte ilhas.
        """
        import make_mixed

        por_digesto: dict[str, list[str]] = {}
        for nome in make_mixed.MIX_TEMPLATES:
            por_digesto.setdefault(make_mixed.mix_template_digest(nome), []).append(nome)
        repetidos = {d[:16]: n for d, n in por_digesto.items() if len(n) > 1}
        self.assertEqual(repetidos, {})
        self.assertEqual(len(por_digesto), len(make_mixed.MIX_TEMPLATES))
        # E as tres coordenadas estao DECLARADAS na receita, porque quem decide le o campo:
        # recuperar a operacao partindo o nome faria do nome um esquema.
        for nome, spec in make_mixed.MIX_TEMPLATES.items():
            with self.subTest(nome=nome):
                if spec["operation"] is None:
                    self.assertIsNone(spec["intent"])
                    self.assertIsNone(spec["register"])
                    continue
                self.assertIn(spec["operation"], assemble_corpus.MIX_OPERATIONS)
                self.assertIn(spec["intent"], make_mixed.MIX_INTENTS)
                self.assertIn(spec["register"], make_mixed.MIX_REGISTERS)
                # A prosa das tres coordenadas esta no corpo, e nao so nos campos.
                corpo = spec["template"]
                self.assertIn(make_mixed.MIX_INTENTS[spec["intent"]], corpo)
                self.assertIn(make_mixed.MIX_REGISTERS[spec["register"]], corpo)
                self.assertIn(
                    make_mixed.MIX_GEOMETRIES[spec["operation"]].split("{nivel}")[0],
                    corpo,
                )

    def test_o_vocabulario_de_GEOMETRIA_espelha_o_do_plano(self):
        """As chaves de `MIX_GEOMETRIES` SAO `MIX_OPERATIONS`, e a ordem tambem.

        O espelho existe porque ler o plano no topo deste arquivo obrigaria
        `make_mixed_agy.py` e `make_mixed_codex.py` a arrastar `artifact_gate` ->
        `generate_ai` so para compor um prompt. Uma operacao acrescentada ao plano sem
        geometria aqui deixaria o slate sem o slot dela, e a igualdade e o que faz isso ficar
        vermelho neste arquivo em vez de silencioso na composicao.
        """
        import make_mixed

        self.assertEqual(
            tuple(make_mixed.MIX_GEOMETRIES), assemble_corpus.MIX_OPERATIONS
        )
        self.assertEqual(
            make_mixed._MIX_SLATE_ISLAND_COUNT, len(assemble_corpus.ISLAND_PLAN)
        )

    def test_a_atribuicao_de_ilha_a_INTENCAO_e_REGISTRO_e_uma_bijecao_de_vinte(self):
        """Quatro intencoes por cinco registros dao as vinte ilhas, uma coordenada cada.

        Duas ilhas com a mesma coordenada teriam, por operacao, templates de BYTES identicos
        — e a particao de ilha viraria nominal sem que contagem alguma se movesse. A cobertura
        e a outra metade: as vinte coordenadas possiveis sao todas usadas.
        """
        import make_mixed

        pares = [
            make_mixed._mix_pair(i)
            for i in range(make_mixed._MIX_SLATE_ISLAND_COUNT)
        ]
        self.assertEqual(len(set(pares)), len(pares))
        todas = {
            (intencao, registro)
            for intencao in make_mixed.MIX_INTENTS
            for registro in make_mixed.MIX_REGISTERS
        }
        self.assertEqual(set(pares), todas)
        self.assertEqual(len(todas), 20)
        # A aritmetica CONGELADA recusa em vez de estourar num IndexError: quem crescer o
        # plano descobre aqui que tem uma decisao a tomar sobre as listas.
        with mock.patch.object(make_mixed, "_MIX_SLATE_ISLAND_COUNT", 25):
            with self.assertRaises(make_mixed.MixSlateArithmetic) as erro:
                make_mixed._mix_pair(0)
        self.assertIn("20 coordenadas", str(erro.exception))

    def test_o_NIVEL_e_parametro_preenchido_e_NAO_move_o_digesto(self):
        """A § 3.3 declara o nivel como parametro que nao move o digesto; aqui isso e medido.

        E o que faz D7 ser aplicacao de politica e nao politica nova: o nudge reexecuta o
        MESMO template noutro nivel, e o cluster de `promptTemplate` continua a ser um por
        operacao. As duas metades sao necessarias — o digesto CONSTANTE e o prompt VARIAVEL —,
        porque um template que ignorasse o nivel teria digesto constante tambem.
        """
        import make_mixed

        nome = "mix-substituicao-ilha-00"
        digesto = make_mixed.mix_template_digest(nome)
        corpo = make_mixed.MIX_TEMPLATES[nome]["template"]
        rendidos = {
            nivel: corpo.format(parent="PAI", nivel=nivel)
            for nivel in assemble_corpus.MIX_LEVELS
        }
        self.assertEqual(len(set(rendidos.values())), len(assemble_corpus.MIX_LEVELS))
        for nivel, texto in rendidos.items():
            with self.subTest(nivel=nivel):
                self.assertIn(f"aproximadamente {nivel} %", texto)
                self.assertEqual(make_mixed.mix_template_digest(nome), digesto)

    def test_o_digesto_de_uma_identidade_MISTA_nao_move_com_o_slate_de_GERACAO(self):
        """D6 bis, medido: as duas autoridades sao independentes.

        Derivar os registros do slate de geracao faria o mesmo `promptTemplateId` adquirir
        outro digesto quando a atribuicao de la mudasse, e uma linha JA persistida guardaria o
        digesto antigo sob o mesmo id — dano permanente e invisivel, porque o resume nao
        reescreve linha escrita. A prova reconstroi o slate misto com o de geracao TROCADO e
        exige digesto identico; as cinco frases duplicadas sao o preco disso.
        """
        import generate_ai
        import make_mixed

        antes = {
            nome: make_mixed.mix_template_digest(nome)
            for nome, spec in make_mixed.MIX_TEMPLATES.items()
            if spec["operation"] is not None
        }
        outros_registros = {
            nome: f"Use registro {nome}: OUTRA FRASE INTEIRAMENTE."
            for nome in generate_ai.GENERATION_REGISTERS
        }
        outras_tarefas = {
            nome: f"Faca OUTRA COISA com {{words}} palavras ({nome})."
            for nome in generate_ai.GENERATION_TASKS
        }
        with mock.patch.object(
            generate_ai, "GENERATION_REGISTERS", outros_registros
        ):
            with mock.patch.object(generate_ai, "GENERATION_TASKS", outras_tarefas):
                reconstruido = make_mixed._build_mix_slate()
                # Nao vacuo, e DENTRO do patch: o slate de GERACAO reconstruido sob ele muda,
                # entao o patch alcanca de facto quem o le. Fora do `with` ele nao alcancaria
                # nada, e a prova toda ficaria verde por acidente.
                de_geracao = generate_ai._build_slate()
        self.assertNotEqual(
            de_geracao["pt-ilha-00-a"]["template"],
            generate_ai.RECIPES["pt-ilha-00-a"]["template"],
        )
        import hashlib

        depois = {
            nome: hashlib.sha256(
                reconstruido[nome]["template"].encode("utf-8")
            ).hexdigest()
            for nome in antes
        }
        self.assertEqual(depois, antes)

    def test_a_cobertura_de_sonda_de_ECO_do_prompt_misto_esta_MEDIDA(self):
        """Quanto do pedido misto o gate antiartefato ja sonda, e o que ele NAO sonda.

        `artifact_gate._echo_probes_from_templates` deriva as sondas de `generate_ai.RECIPES`
        e de nada mais, entao as sessenta receitas de mistura nao acrescentam sonda nenhuma. O
        que este corpo mede e onde isso importa:

        * o FECHO e coberto, pela sonda escrita a mao `responda apenas com`;
        * a clausula de REGISTRO e coberta — e e o dividendo de D6 bis: as frases sao byte a
          byte as do slate de geracao, entao os chunks delas JA sao sondas derivadas dele. A
          duplicacao que parecia desperdicio compra independencia de digesto E cobertura;
        * a GEOMETRIA e a INTENCAO nao tem sonda, e isso e o residuo declarado: uma linha
          mista que ecoe "substitua uma secao contigua" passa. Crescer `_echo_probes_from_templates`
          para ler `MIX_TEMPLATES` fecharia o vao e MUDARIA a taxa medida contra o teto
          PRE-INSCRITO de 2 %, entao e medicao com unidade propria e nao efeito colateral
          desta. Quando alguem a fizer, este corpo fica vermelho — que e o ponto dele.
        """
        import re

        import artifact_gate
        import generate_ai
        import make_mixed

        def coberto(frase: str) -> bool:
            dobrado = artifact_gate.fold(frase)
            return any(
                re.search(padrao, dobrado)
                for padrao in artifact_gate.ECHO_PROBES.values()
            )

        self.assertTrue(coberto(make_mixed._MIX_CLOSING))
        # Os CINCO registros, e a razao de estarem cobertos: as frases sao identicas as do
        # slate de geracao, de onde as sondas saem.
        for nome, frase in make_mixed.MIX_REGISTERS.items():
            with self.subTest(registro=nome):
                self.assertEqual(frase, generate_ai.GENERATION_REGISTERS[nome])
                self.assertTrue(coberto(frase))
        # E o residuo, sobre TODAS as geometrias e TODAS as intencoes: uma sonda acrescentada
        # para uma delas deixa este corpo vermelho, e e o que impede o ESTADO de continuar a
        # declarar o vao depois de metade dele estar fechada.
        for nome, geometria in make_mixed.MIX_GEOMETRIES.items():
            with self.subTest(geometria=nome):
                self.assertFalse(coberto(geometria.split("{nivel}")[0]))
        for nome, intencao in make_mixed.MIX_INTENTS.items():
            with self.subTest(intencao=nome):
                self.assertFalse(coberto(intencao))

    def test_a_CELULA_por_indice_e_a_mesma_no_plano_e_na_pista(self):
        """Uma aritmetica so: `_island_component` e o laco do driver leem a MESMA funcao.

        Duas expansoes da mesma conta concordam hoje e podem divergir amanha sem nada
        reprovar, e o que divergiria e o que a linha ESTAMPA contra o que o preflight VALIDA.
        A assercao e por indice e nao por total, porque totais iguais sobrevivem a uma
        permutacao que rachasse a paridade dos clusters.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        mistas = ilha["lines"]["mixed"]
        alocacao = assemble_corpus.mix_cell_allocation(mistas)
        self.assertEqual(len(alocacao), mistas)
        do_plano = [
            group_axes.identity_of(rec["groups"]["promptTemplate"])
            for rec in assemble_corpus._island_component(ilha)
            if rec["label"] == "mixed"
        ]
        da_alocacao = [
            ilha["mixingTemplates"][operacao] for operacao, _nivel in alocacao
        ]
        self.assertEqual(do_plano, da_alocacao)
        # A funcao e TOTAL, e a soma fecha em toda cota — inclusive nas que nao dividem.
        for cota in (0, 1, 7, 19, 20, 21, 100, 133, 940):
            with self.subTest(cota=cota):
                self.assertEqual(len(assemble_corpus.mix_cell_allocation(cota)), cota)

    def test_o_RESTO_da_alocacao_vai_para_as_PRIMEIRAS_celulas(self):
        """A cota de producao divide exacto, entao o ramo do resto so tem adversario aqui.

        ACHADO da bateria: mover o resto para as ULTIMAS celulas deixava a suite do lab
        INDISTINGUIVEL — 732/718, o mesmo numero —, porque 100 linhas em 20 celulas dao 5 e o
        resto e zero, e as outras assercoes sobre a alocacao olham a SOMA. A regra declarada e
        "o resto vai para as primeiras, na ordem de `mix_cells`", e ela nao e cosmetica: e ela
        que decide os totais por OPERACAO num plano cuja cota de ilha nao divide — 15 ilhas dao
        133 mistas —, e `_island_component` modela a geometria com esses totais.
        """
        celulas = assemble_corpus.mix_cells()
        # Uma linha a mais que celulas: a PRIMEIRA celula leva duas, todas as outras uma.
        uma_a_mais = assemble_corpus.mix_cell_allocation(len(celulas) + 1)
        self.assertEqual(uma_a_mais[:2], (celulas[0], celulas[0]))
        self.assertEqual(uma_a_mais[-1], celulas[-1])
        # E o plano de 15 ilhas, onde o resto e grande: 133 = 6 x 20 + 13, entao as treze
        # PRIMEIRAS celulas levam sete e as sete ultimas levam seis.
        contagem: dict[tuple[str, int], int] = {}
        for celula in assemble_corpus.mix_cell_allocation(133):
            contagem[celula] = contagem.get(celula, 0) + 1
        self.assertEqual([contagem[c] for c in celulas[:13]], [7] * 13)
        self.assertEqual([contagem[c] for c in celulas[13:]], [6] * 7)

    def test_a_curva_e_as_operacoes_RATIFICADAS_estao_pinadas_por_valor(self):
        """Os dois vocabularios que o § 3.3 ratifica, LIDOS por teste e nao so derivados.

        Tudo o resto neste arquivo os deriva, e derivar e certo — mas nenhuma derivacao recusa
        um oitavo nivel ou uma quarta operacao acrescentados a lista, e sem este corpo
        acrescentar um deixa a suite do lab indistinguivel. Os niveis DIRIGEM o prompt e o
        nudge, entao um nivel a mais e uma celula que a cota do plano nao compra e um pedido
        que autoridade nenhuma ratificou.

        A aritmetica da alocacao esta junta porque e ela que o § 3.3 publica: por nivel, 200
        linhas em v1 e 300 nas outras seis; a coorte alvo de `aiFraction` >= 0,50 e v4-v7, isto
        e 1.200 linhas, 60 % da classe mista.
        """
        self.assertEqual(assemble_corpus.MIX_LEVELS, (15, 25, 40, 50, 60, 75, 90))
        self.assertEqual(
            assemble_corpus.MIX_OPERATIONS,
            ("substituicao", "insercao", "concatenacao"),
        )
        self.assertEqual(assemble_corpus.MIX_CELL_EXCLUDED, (("insercao", 15),))
        por_nivel: dict[int, int] = {}
        for ilha in assemble_corpus.ISLAND_PLAN:
            for _operacao, nivel in assemble_corpus.mix_cell_allocation(
                ilha["lines"]["mixed"]
            ):
                por_nivel[nivel] = por_nivel.get(nivel, 0) + 1
        self.assertEqual(
            por_nivel, {15: 200, 25: 300, 40: 300, 50: 300, 60: 300, 75: 300, 90: 300}
        )
        alta = sum(quantas for nivel, quantas in por_nivel.items() if nivel >= 50)
        self.assertEqual(alta, 1200)
        self.assertEqual(
            alta / assemble_corpus.ISLAND_PLAN_CLASS_LINES["mixed"], 0.60
        )

    def test_a_pista_mista_realiza_as_VINTE_celulas_da_ilha(self):
        """O laco itera as CELULAS, e o que se mede e a linha escrita — nao a intencao.

        Cem pais da ilha, uma resposta em banda para todos, e o multiconjunto de
        `(mixOperation, mixLevel)` das cem linhas TEM de ser a alocacao do plano. Um laco que
        conhecesse so os pais escreveria cem vezes a mesma coisa, e um que embaralhasse a
        ordem quebraria a contiguidade dos clusters que a geometria compra.

        A identidade acompanha: cada linha leva o slot da SUA operacao, com a multiplicidade
        35/30/35 que `mix_lines_by_operation` deriva.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        alocacao = assemble_corpus.mix_cell_allocation(ilha["lines"]["mixed"])
        linhas, _prompts = self._gerar(ilha=ilha)
        self.assertEqual(len(linhas), len(alocacao))
        escritas = [(l["mixOperation"], l["mixLevel"]) for l in linhas]
        self.assertEqual(escritas, list(alocacao))
        self.assertEqual(len(set(escritas)), len(assemble_corpus.mix_cells()))
        por_identidade: dict[str, int] = {}
        for l in linhas:
            por_identidade[l["promptTemplateId"]] = (
                por_identidade.get(l["promptTemplateId"], 0) + 1
            )
        self.assertEqual(
            por_identidade,
            {
                ilha["mixingTemplates"][operacao]: quantas
                for operacao, quantas in assemble_corpus.mix_lines_by_operation(
                    ilha["lines"]["mixed"]
                ).items()
            },
        )

    def test_a_celula_e_funcao_do_PAI_e_sobrevive_a_retomada_e_ao_excedente(self):
        """A celula sai da posicao do pai na ilha INTEIRA, e nao da ordem da corrida.

        As duas propriedades entram no mesmo corpo porque o mesmo fixture as separa, e nenhuma
        das duas tinha adversario: todo outro caso escreve num `--output` novo (logo `done`
        vazio) e alimenta pais em numero igual a cota (logo o teto nunca morde).

        RETOMADA. `done` conta as linhas de TODAS as ilhas no mesmo `--output`, entao indexar a
        alocacao pela ordem da corrida daria celula diferente ao mesmo pai a cada retomada: a
        primeira corrida para na cota seca, a segunda reindexa, as celulas iniciais ficam
        pedidas duas vezes e as finais — as de nivel 90, a coorte alta da ilha — nunca sao
        pedidas. A linha gravaria `mixLevel` de um pedido que nao foi feito para ela.

        EXCEDENTE. O arquivo de pais e do corpus inteiro e a ilha tem mais pai elegivel que
        cota (o pool reservado da ~112 por bloco de semente contra 100 mistas). Sem o teto, o
        101.o pai recebe a celula 0 de novo e a ilha escreve linha fora do plano.

        A assercao unica que separa os tres casos e a SEQUENCIA de `(mixOperation, mixLevel)`
        das linhas escritas contra a alocacao: com a indexacao por corrida ela repete o prefixo,
        com atribuicao ciclica ela e mais longa que a cota, e so a forma correta a reproduz.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        cota = ilha["lines"]["mixed"]
        alocacao = assemble_corpus.mix_cell_allocation(cota)
        excedente = 5
        pais = pais_da_ilha(ilha["island"], cota + excedente)
        linhas, _prompts = self._gerar(ilha=ilha, pais=pais, passos=[40, cota])
        self.assertEqual(len(linhas), cota)
        self.assertEqual(
            [(l["mixOperation"], l["mixLevel"]) for l in linhas], list(alocacao)
        )
        # O pai da posicao `i` e o da linha `i`, nas duas corridas: e isto que faz a celula ser
        # funcao do pai. Sem a igualdade acima isto passaria com as celulas permutadas.
        self.assertEqual([l["parentId"] for l in linhas], pais[:cota])
        # E os excedentes nao recebem celula, logo nao sao tentados nem numa retomada.
        escritos = {l["parentId"] for l in linhas}
        for extra in pais[cota:]:
            with self.subTest(pai=extra):
                self.assertNotIn(extra, escritos)

    def test_o_nivel_vizinho_NAO_existe_nas_DUAS_pontas_da_curva(self):
        """A ponta e afirmada nas duas direcoes, e o laco so exercita uma.

        O nudge do driver so alcanca a celula 0, entao a ponta ALTA — nivel 90 pedindo o vizinho
        de cima — nao tem adversario por lá. Ela importa igual: uma resposta de 90 % que volta
        em 0,62 fica fora de banda por BAIXO, pede o vizinho de cima e nao o tem; grampear ali
        gastaria uma chamada por linha das quinze de nivel 90 da ilha para comprar outra amostra
        do mesmo sorteio.

        O interior tambem e afirmado, nas duas direcoes, porque sem ele "devolve None" seria
        satisfeito por uma funcao que devolve `None` sempre.
        """
        import make_mixed

        niveis = assemble_corpus.MIX_LEVELS
        self.assertIsNone(make_mixed.adjacent_mix_level(niveis[0], para_baixo=True))
        self.assertIsNone(make_mixed.adjacent_mix_level(niveis[-1], para_baixo=False))
        for posicao, nivel in enumerate(niveis):
            with self.subTest(nivel=nivel):
                if posicao + 1 < len(niveis):
                    self.assertEqual(
                        make_mixed.adjacent_mix_level(nivel, para_baixo=False),
                        niveis[posicao + 1],
                    )
                if posicao > 0:
                    self.assertEqual(
                        make_mixed.adjacent_mix_level(nivel, para_baixo=True),
                        niveis[posicao - 1],
                    )

    def test_o_prompt_ENVIADO_pede_a_geometria_e_o_nivel_da_celula(self):
        """A linha e o pedido dizem a MESMA celula, e e o pedido que produziu o texto.

        Sem esta metade, um laco podia estampar a celula certa na linha e mandar sempre o
        mesmo prompt — a alegacao seria falsa e toda contagem continuaria certa. Sao as duas
        pontas do mesmo par: a geometria da operacao e o numero do nivel.
        """
        import make_mixed

        ilha = assemble_corpus.ISLAND_PLAN[0]
        alocacao = assemble_corpus.mix_cell_allocation(ilha["lines"]["mixed"])
        linhas, prompts = self._gerar(ilha=ilha)
        self.assertTrue(prompts)
        self.assertEqual(len(prompts), len(linhas))
        for indice, (prompt, (operacao, nivel)) in enumerate(
            zip(prompts, alocacao, strict=True)
        ):
            with self.subTest(indice=indice):
                self.assertIn(f"aproximadamente {nivel} %", prompt)
                self.assertIn(
                    make_mixed.MIX_GEOMETRIES[operacao].split("{nivel}")[0], prompt
                )
                # E NAO pede a geometria de outra operacao: as tres frases sao distintas, e
                # sem esta metade um prompt que as concatenasse todas passaria.
                for outra, geometria in make_mixed.MIX_GEOMETRIES.items():
                    if outra != operacao:
                        self.assertNotIn(geometria.split("{nivel}")[0], prompt)

    def test_o_nudge_reexecuta_o_MESMO_template_no_nivel_VIZINHO(self):
        """D7 no mecanismo: a correcao mora no PARAMETRO e a identidade nao se move.

        A primeira resposta e o pai palavra por palavra — `aiFraction` 0, fora de banda por
        baixo —, entao o nudge pede o nivel de CIMA. O que se afirma: o segundo prompt e do
        MESMO template, com o nivel vizinho, e a linha grava o nivel que sobreviveu. Trocar
        de template aqui subcontaria as sessenta identidades, e gravar o nivel da celula
        alegaria um pedido que nao produziu este texto.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        operacao, alvo = assemble_corpus.mix_cell_allocation(ilha["lines"]["mixed"])[0]
        vizinho = assemble_corpus.MIX_LEVELS[
            assemble_corpus.MIX_LEVELS.index(alvo) + 1
        ]
        texto = " ".join(f"palavra{i:02d}" for i in range(60))
        (pai_id,) = pais_da_ilha(ilha["island"])
        linhas, prompts = self._gerar(
            ilha=ilha, pais=[pai_id], target=1, respostas=[texto]
        )
        self.assertEqual(len(prompts), 2)
        self.assertIn(f"aproximadamente {alvo} %", prompts[0])
        self.assertIn(f"aproximadamente {vizinho} %", prompts[1])
        self.assertEqual(len(linhas), 1)
        self.assertEqual(linhas[0]["promptTemplateId"], ilha["mixingTemplates"][operacao])
        self.assertEqual(linhas[0]["mixOperation"], operacao)
        self.assertEqual(linhas[0]["mixLevel"], vizinho)

    def test_o_nudge_NAO_gasta_chamada_na_ponta_da_curva(self):
        """Na ponta nao ha vizinho, e a resposta e nao pedir de novo.

        A celula 0 pede o nivel mais baixo; a resposta vem 100 % de IA, isto e, fora de banda
        por CIMA, e o vizinho de baixo nao existe. Reexecutar o mesmo pedido no mesmo nivel
        compraria outra amostra do mesmo sorteio ao preco de cota, entao a corrida para: UMA
        chamada e zero linha. Uma implementacao que grampeasse o nivel na ponta faria duas.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        _operacao, alvo = assemble_corpus.mix_cell_allocation(ilha["lines"]["mixed"])[0]
        self.assertEqual(alvo, assemble_corpus.MIX_LEVELS[0])
        tudo_novo = " ".join(f"novo{i:02d}" for i in range(60))
        (pai_id,) = pais_da_ilha(ilha["island"])
        import make_mixed

        # O fixture se confere nas duas condicoes que o caso precisa: fora de banda, e fora
        # por CIMA — e a segunda e o que escolhe a direcao do nudge.
        mistura = make_mixed.compute_mixture(
            " ".join(f"palavra{i:02d}" for i in range(60)), tudo_novo
        )
        self.assertFalse(make_mixed.in_mixed_band(mistura))
        self.assertGreaterEqual(mistura["aiFraction"], make_mixed.mixed_bands()[-1][2])
        linhas, prompts = self._gerar(
            ilha=ilha, pais=[pai_id], target=1, respostas=[tudo_novo, tudo_novo]
        )
        self.assertEqual(len(prompts), 1)
        self.assertEqual(linhas, [])

    def test_a_pista_mista_so_toma_pai_do_PROPRIO_bloco_de_semente(self):
        """Pai de outra ilha FUNDE as duas, e a recusa e por construcao e nao por aviso.

        Uma linha mista nomeia o pai em `humanSeed` e `derivationRoot`, e
        `connected_components` une POR VALOR: um pai do bloco de outra ilha faz das duas um
        componente, e a montagem recusa o corpo DEPOIS de a cota estar gasta. O arquivo de
        pais e do corpus inteiro; a corrida toma a fatia da sua ilha.
        """
        ilha = assemble_corpus.ISLAND_PLAN[0]
        (meu,) = pais_da_ilha(ilha["island"])
        (alheio,) = pais_da_ilha(assemble_corpus.ISLAND_PLAN[1]["island"])
        linhas, _prompts = self._gerar(ilha=ilha, pais=[alheio, meu], target=10)
        self.assertEqual([l["parentId"] for l in linhas], [meu])

    def test_emit_RECUSA_a_operacao_que_a_identidade_nao_declara(self):
        """UMA igualdade fecha as quatro direcoes, e e ela que impede a alegacao falsa.

        Estampar `mix-substituicao-ilha-00` numa linha que fez outra geometria e alegacao
        falsa GRAVADA no corpus, e o dano nao e reparavel depois: a identidade e o digesto de
        um prompt que pede uma geometria so. As quatro direcoes sao identidade de ilha sem
        operacao, identidade de ilha com a operacao de outro slot, receita legada COM
        operacao, e grafia que o vocabulario nao tem.
        """
        import io

        import make_mixed

        pai = " ".join(f"palavra{i:02d}" for i in range(60))
        editado = " ".join(
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        )
        casos = {
            "ilha sem operacao": ("mix-substituicao-ilha-00", None, None),
            "ilha com outra operacao": (
                "mix-substituicao-ilha-00",
                "concatenacao",
                50,
            ),
            "legada com operacao": ("mix_edit_v1", "substituicao", 50),
            "grafia alienigena": ("mix-substituicao-ilha-00", "substituição", 50),
        }
        for rotulo, (identidade, operacao, nivel) in casos.items():
            with self.subTest(caso=rotulo):
                with self.assertRaises(ValueError) as erro:
                    make_mixed.emit(
                        io.StringIO(),
                        {
                            "id": "src_pai_000000",
                            "text": pai,
                            "family": "ptwiki_lead",
                            "sourceMaterialBatch": "smb_ptwiki_20220301",
                        },
                        editado,
                        provider="gemini",
                        model="gemini-3.5-flash-lite",
                        template_id=identidade,
                        mix_operation=operacao,
                        mix_level=nivel,
                    )
                self.assertIn("operacao", str(erro.exception))
                self.assertIn(identidade, str(erro.exception))
        # Nao vacuo: com a operacao que a identidade declara, o mesmo `emit` escreve.
        destino = io.StringIO()
        make_mixed.emit(
            destino,
            {
                "id": "src_pai_000000",
                "text": pai,
                "family": "ptwiki_lead",
                "sourceMaterialBatch": "smb_ptwiki_20220301",
            },
            editado,
            provider="gemini",
            model="gemini-3.5-flash-lite",
            template_id="mix-substituicao-ilha-00",
            mix_operation="substituicao",
            mix_level=50,
        )
        self.assertEqual(json.loads(destino.getvalue())["mixOperation"], "substituicao")

    def test_emit_RECUSA_nivel_incoerente_com_a_operacao(self):
        """O nivel existe exactamente quando a operacao existe, e vem da curva.

        Tres direcoes: identidade de ilha sem nivel, identidade de ilha com nivel que a curva
        nao declara, e receita legada COM nivel. O nivel e o alvo da operacao — sem operacao
        ele nao tem do que ser alvo, e um valor fora de `MIX_LEVELS` nomeia uma celula que o
        plano nao compra.
        """
        import io

        import make_mixed

        pai = " ".join(f"palavra{i:02d}" for i in range(60))
        editado = " ".join(
            (f"reescrito{i:02d}" if i < 8 else f"palavra{i:02d}") for i in range(60)
        )
        casos = {
            "ilha sem nivel": ("mix-substituicao-ilha-00", "substituicao", None),
            "nivel fora da curva": ("mix-substituicao-ilha-00", "substituicao", 55),
            "legada com nivel": ("mix_edit_v1", None, 50),
        }
        for rotulo, (identidade, operacao, nivel) in casos.items():
            with self.subTest(caso=rotulo):
                with self.assertRaises(ValueError) as erro:
                    make_mixed.emit(
                        io.StringIO(),
                        {
                            "id": "src_pai_000000",
                            "text": pai,
                            "family": "ptwiki_lead",
                            "sourceMaterialBatch": "smb_ptwiki_20220301",
                        },
                        editado,
                        provider="gemini",
                        model="gemini-3.5-flash-lite",
                        template_id=identidade,
                        mix_operation=operacao,
                        mix_level=nivel,
                    )
                self.assertIn("nivel", str(erro.exception))

    def test_o_slate_misto_de_BYTES_IDENTICOS_e_recusado_antes_da_cota(self):
        """A fraude que crescer o slate abriu: sessenta nomes sobre corpos repetidos.

        Ela passa a conferencia por NOME — a quinta perna — e mente, porque identidade E o
        digesto dos bytes: a particao de ilha ficaria NOMINAL e o recall voltaria a ser medido
        sobre prompts ja vistos. A recusa e do `argparse`, entao morde antes de qualquer
        chamada de provedor, e o fixture serve os nomes todos de proposito para que a quinta
        perna nao dispare primeiro.
        """
        import argparse

        import make_mixed

        ilha = assemble_corpus.ISLAND_PLAN[0]
        alias = dict(make_mixed.MIX_TEMPLATES)
        alias[ilha["mixingTemplates"]["insercao"]] = dict(
            alias[ilha["mixingTemplates"]["substituicao"]]
        )
        with mock.patch.object(make_mixed, "MIX_TEMPLATES", alias):
            with self.assertRaises(argparse.ArgumentTypeError) as erro:
                make_mixed.island_plan(ilha["island"])
        mensagem = str(erro.exception)
        self.assertIn("bytes identicos", mensagem)
        self.assertIn(ilha["mixingTemplates"]["insercao"], mensagem)
        self.assertIn("NOMINAL", mensagem)

    def test_assume_template_NAO_admite_identidade_de_ilha(self):
        """A afirmacao do operador vale sobre receita legada, e so sobre ela.

        `--assume-template` afirma qual prompt produziu um arquivo de pares ANTIGO. Oferecer
        as sessenta identidades daria ao operador uma forma de atribuir pertenca de ilha e uma
        geometria a linhas que fizeram um edit generico — a mesma alegacao falsa, por outra
        porta. A recusa e do `argparse`, e o caso VERDE ao lado prova que a flag continua a
        funcionar para o que ela e.
        """
        import contextlib
        import io
        import tempfile

        import make_mixed

        self.assertEqual(
            set(make_mixed.LEGACY_MIX_TEMPLATE_IDS),
            {
                nome
                for nome, spec in make_mixed.MIX_TEMPLATES.items()
                if spec["operation"] is None
            },
        )
        ilha = assemble_corpus.ISLAND_PLAN[0]
        self.assertNotIn(
            ilha["mixingTemplates"]["substituicao"],
            make_mixed.LEGACY_MIX_TEMPLATE_IDS,
        )
        with tempfile.TemporaryDirectory() as bruto:
            temporario = Path(bruto)
            vazio = temporario / "pares.jsonl"
            vazio.write_bytes(b"")
            for rotulo, template in {
                "identidade de ilha": ilha["mixingTemplates"]["substituicao"],
                "receita legada": "mix_edit_v1",
            }.items():
                with self.subTest(caso=rotulo):
                    saida = temporario / f"saida-{template}.jsonl"
                    argv = [
                        "make_mixed.py",
                        "--from-pairs",
                        str(vazio),
                        "--island",
                        ilha["island"],
                        "--output",
                        str(saida),
                        "--assume-template",
                        template,
                    ]
                    erro_padrao = io.StringIO()
                    registrado = io.TextIOWrapper(
                        io.BytesIO(), encoding="utf-8", newline="\n"
                    )
                    with mock.patch.object(sys, "argv", argv):
                        with contextlib.redirect_stderr(erro_padrao):
                            with contextlib.redirect_stdout(registrado):
                                if rotulo == "identidade de ilha":
                                    with self.assertRaises(SystemExit) as saiu:
                                        make_mixed.main()
                                else:
                                    make_mixed.main()
                    if rotulo == "identidade de ilha":
                        self.assertEqual(saiu.exception.code, 2)
                        self.assertIn("--assume-template", erro_padrao.getvalue())
                        self.assertFalse(saida.exists())
                    else:
                        self.assertTrue(saida.exists())


if __name__ == "__main__":
    unittest.main()
