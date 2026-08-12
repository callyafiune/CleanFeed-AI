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

                # O histograma e as contagens por classe MEDIDOS contra os DECLARADOS,
                # antes de qualquer veredito: um materializador que divergiu do outro lado
                # produz outro histograma e fica vermelho aqui, em vez de concordar sobre
                # um corpo que nao e o mesmo.
                declarado = sorted(
                    corrida["lines"].get("human", 0) + corrida["lines"].get("ai", 0)
                    for celula in caso["cells"]
                    for corrida in celula["components"]
                    for _ in range(corrida["count"])
                )
                self.assertEqual(_histograma(registros), declarado)
                self.assertEqual(_classes(registros), esperado["classLines"])

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
            "mixingTemplate": f"mix-{i}",
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
            # Nada foi aberto, nada foi escrito, nada foi gasto.
            self.assertFalse(output.exists())
            self.assertFalse((output.with_name(output.name + ".lock")).exists())
        self.assertEqual(proc.returncode, 2, proc.stderr)
        # A RAZAO, e nao so uma recusa: o eixo que cruzou e as duas ilhas que o partilham.
        self.assertIn("nao particiona o eixo", proc.stderr)
        self.assertIn("template de geracao", proc.stderr)
        self.assertIn("ilha_19", proc.stderr)
        self.assertIn("depois de a cota estar gasta", proc.stderr)

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
                "mixingTemplate": f"mix-{i}",
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
                "mixingTemplate": "mix-0",
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
            ("promptTemplate", "mixingTemplate", lambda i: base[i]["mixingTemplate"]),
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
                    # `templates` e `mixingTemplate`, entao afirmar o campo sozinho passaria
                    # sem o dono carregar coisa alguma.
                    self.assertIn(f"/{campo}", mensagem)

    def test_o_mixingTemplate_de_uma_ilha_nao_pode_ser_o_template_de_geracao_de_outra(self):
        """A colisao CRUZADA entre os dois campos que escrevem o MESMO eixo de registro.

        `_island_component` escreve `groups.promptTemplate` = template de geracao nas linhas
        `ai` e = `mixingTemplate` nas mistas. Um namespace POR CAMPO aprovava um plano cujo
        `mixingTemplate` e o `templates` de outra ilha, e o corpo colapsava com as pernas todas
        verdes — medido, 19 componentes onde o plano declara 20. Nenhuma das outras fixturas
        alcanca este caso: cada uma colide um campo consigo mesmo.
        """
        base = list(_plano(20))
        cruzado = list(base)
        cruzado[-1] = dict(base[-1], mixingTemplate=base[0]["templates"][0])
        with self.assertRaises(assemble_corpus.IslandPlanRefused) as erro:
            assemble_corpus.assert_island_plan_is_a_partition(tuple(cruzado))
        mensagem = str(erro.exception)
        self.assertIn("promptTemplate", mensagem)
        # Os DOIS DONOS nomeados com o campo de onde o valor veio, que e o que torna a
        # mensagem diagnostica. Afirmar so "templates" e "mixingTemplate" seria satisfeito
        # pela PROSA ESTATICA da recusa, que cita os dois nomes de campo — a carga e o par
        # `ilha/campo`, e e por ele que se afirma.
        self.assertIn("ilha_19/mixingTemplate", mensagem)
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
                    "mixingTemplate": f"mt-{indice:02d}",
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
                "mixingTemplate": f"mix-{i}",
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

    def test_o_piso_de_TEMPLATES_de_um_plano_conforme_e_15_e_o_slate_declara_4(self):
        """O preco em TEMPLATES, que e o que o operador paga, medido nas duas pontas.

        O piso de 15 nao e gosto: um plano de 14 ilhas UNIFORMES e recusado pelo preflight
        porque o MENOR componente vale 7,14 % contra o teto de 7 % de `dev`, e 15 passa. E a
        particao exige identidade de template em UMA ilha so, entao N ilhas pedem N templates
        DISTINTOS no minimo — logo 15 e o piso de templates de qualquer plano conforme.

        `ISLAND_PLAN` declara 20 ilhas de dois templates e pede 40; `RECIPES` declara quatro
        nomes. Por isso `island_plan` recusa TODA ilha hoje, e essa recusa e a guarda a
        funcionar antes da cota — nao um defeito.
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
        # E o slate nao os serve: a ilha e recusada e a razao NOMEIA os que faltam.
        self.assertEqual(len(generate_ai.RECIPES), 4)
        for ilha in assemble_corpus.ISLAND_PLAN[:3]:
            with self.subTest(ilha=ilha["island"]):
                with self.assertRaises(argparse.ArgumentTypeError) as recusa:
                    generate_ai.island_plan(ilha["island"])
                self.assertIn("os que faltam sao", str(recusa.exception))
        # E a recusa vale para TODAS as vinte, o que se mede sem pagar a geometria vinte
        # vezes: nenhum template do plano esta no slate.
        self.assertEqual(
            [nome for nome in templates if nome in generate_ai.RECIPES], []
        )

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

        Os templates da ilha sao os dois de MENOR peso do slate (`social` 2, `humanizado` 1,
        contra `original` 5): sob a mutacao, `recipe_for` sorteia por peso e as linhas caem em
        `original` com probabilidade dominante, entao a mutacao morde em vez de coincidir.
        """
        import json as _json
        import tempfile
        from unittest import mock as _mock

        import generate_ai

        receitas = ("social", "humanizado")
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


if __name__ == "__main__":
    unittest.main()
