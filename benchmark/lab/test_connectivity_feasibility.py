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
    quando o chamador os passa. Os dois nao unem — nao estao em `SPLIT_GROUP_KEYS` —, entao
    compartilhar identidade nao muda componente algum aqui: e o que permite descrever a forma
    que o montador produz, em que uma receita cobre centenas de linhas, e medir a geometria
    que os eixos de receita produziriam se estivessem na uniao.
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
        """Guarda de estado: os dois pares — grosso e de receita — estao FORA.

        Escrito como igualdade e nao como pertinencia. Uma lista de `assertIn` aceita um
        sexto eixo acrescentado em silencio, e e justamente acrescentar `domainSource`,
        `sourceMaterialBatch` ou `promptTemplate` que os testes abaixo mostram ser fatal.
        """
        self.assertEqual(
            SPLIT_GROUP_KEYS,
            (
                "author",
                "source",
                "generationBatch",
                "nearDuplicate",
                "derivationRoot",
            ),
        )
        self.assertNotIn("domainSource", SPLIT_GROUP_KEYS)
        self.assertNotIn("sourceMaterialBatch", SPLIT_GROUP_KEYS)
        # O par de APARELHO: receita nao identifica unidade de amostragem, e o que os
        # exclui e o FECHO DOS DOIS juntos (a classe inteira num componente), nao cada um
        # sozinho — `generatorVersion` REFINA a familia e nao a repete.
        self.assertNotIn("promptTemplate", SPLIT_GROUP_KEYS)
        self.assertNotIn("generatorVersion", SPLIT_GROUP_KEYS)
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

    def test_todo_eixo_da_uniao_identifica_material_ou_une_nada(self):
        material = eixos_de_identidade_de_material()
        por_inercia: list[str] = []
        for eixo in SPLIT_GROUP_KEYS:
            if eixo in material:
                continue
            por_inercia.append(eixo)
            sem_o_eixo = tuple(k for k in SPLIT_GROUP_KEYS if k != eixo)
            for nome, registros in self.corpos:
                with self.subTest(eixo=eixo, caso=nome):
                    self.assertEqual(
                        self._componentes_sob(registros, SPLIT_GROUP_KEYS),
                        self._componentes_sob(registros, sem_o_eixo),
                    )
        # Nao vacuo nas duas pernas: a de material tem entrada e a de inercia tem entrada.
        self.assertEqual(por_inercia, ["generationBatch", "nearDuplicate"])
        self.assertEqual(
            [eixo for eixo in SPLIT_GROUP_KEYS if eixo in material],
            ["author", "source", "derivationRoot"],
        )

    def test_a_perna_de_inercia_e_uma_medicao_e_nao_uma_formalidade(self):
        """O contraste: um eixo que NAO e inerte muda a contagem, e por isso e recusado.

        Sem esta medicao a perna de inercia passaria por qualquer eixo, inclusive um que
        colapsa a classe — e a lista voltaria a ser prosa.
        """
        nome, registros = next(
            (n, r) for n, r in self.corpos if n == "forma-medida-da-classe-gerada"
        )
        del nome
        base = self._componentes_sob(registros, SPLIT_GROUP_KEYS)
        for eixo in ("promptTemplate", "generatorVersion"):
            with self.subTest(eixo=eixo):
                self.assertNotEqual(
                    base, self._componentes_sob(registros, SPLIT_GROUP_KEYS + (eixo,))
                )

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

    def test_a_forma_medida_colapsa_quando_os_eixos_de_receita_unem(self):
        """A classe gerada que o montador PRODUZ, e o que os eixos de receita fariam com ela.

        O caso descreve a forma medida: 1170 linhas ai com quatro identidades de
        `promptTemplate` em corridas de 641/231/213/85 e cinco de `generatorVersion` em
        493/320/256/99/2. Sob a uniao de cinco chaves cada linha e seu componente. Com os
        eixos de receita na uniao o corpo colapsa, e a recusa e a do MAIOR componente — no
        escopo do corpo e no da classe `ai`, que num corpo mono-classe e a mesma comparacao
        sobre as mesmas linhas.

        Um fixture com um template por linha faria as duas pernas passarem sobre uma classe
        gerada que ninguem produz, e e por ai que a inviabilidade atravessou verde.
        """
        caso = next(
            c
            for c in self.catalogo["cases"]
            if c["name"] == "forma-medida-da-classe-gerada"
        )
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

        declarado = caso["expected"]["recipeUnioned"]

        # A perna que CABE, e ela esta aqui para impedir uma razao falsa de voltar: o
        # comentario de SPLIT_GROUP_KEYS afirmou que `generatorVersion` carrega a
        # identidade de `generatorFamily`, e a medicao o refuta em 0 das 1170 linhas.
        # Version REFINA family, entao unir por version e estritamente mais FRACO que unir
        # pela familia — o que compra a exclusao e o FECHO DO PAR, medido abaixo.
        cabe = declarado["generatorVersionOnly"]
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + tuple(cabe["axes"]),
        ):
            tamanhos = componentes(registros)
            self.assertEqual(len(tamanhos), cabe["components"])
            self.assertEqual(sorted(tamanhos.values()), sorted(cabe["histogram"]))
            # Nao levanta: a guarda aceita este corpo, e e isso que torna o par a razao.
            assert_components_can_fill_five_partitions(registros)
        self.assertEqual(cabe["breaches"], [])
        versoes = {
            group_axes.identity_of(r["groups"]["generatorVersion"]) for r in registros
        }
        self.assertEqual(len(versoes), 5)
        # A comparacao com `generatorFamily` fica do lado TS (viability-preflight.test.ts):
        # este materializador emite ONZE eixos e nao inclui a familia, entao aqui a
        # refutacao e medida pela CONTAGEM de versoes (cinco corridas, nao uma), e a
        # coincidencia linha a linha e afirmada la, sobre o mesmo caso do catalogo.
        self.assertNotIn("generatorFamily", registros[0]["groups"])

        for perna in ("promptTemplateOnly", "bothRecipeAxes"):
            with self.subTest(perna=perna):
                geometria = declarado[perna]
                chaves = SPLIT_GROUP_KEYS + tuple(geometria["axes"])
                with mock.patch.object(
                    assemble_corpus, "SPLIT_GROUP_KEYS", chaves
                ):
                    tamanhos = componentes(registros)
                    self.assertEqual(len(tamanhos), geometria["components"])
                    self.assertEqual(
                        sorted(tamanhos.values()), sorted(geometria["histogram"])
                    )
                    escopos = {
                        escopo: fracoes
                        for escopo, _total, fracoes in (
                            assemble_corpus.component_fractions_by_scope(registros)
                        )
                    }
                    with self.assertRaises(UnsplittableCorpus) as erro:
                        assert_components_can_fill_five_partitions(registros)
                # Os DOIS escopos que o outro lado declara como recusa, medidos aqui: o
                # corpo e a classe `ai`. A guarda estoura no primeiro, entao a mensagem
                # nomeia o corpo, e a igualdade das duas listas de fracoes e o que diz que
                # a classe recusaria pela MESMA condicao.
                declaradas = {v["scope"] for v in geometria["breaches"]}
                self.assertEqual(declaradas, {"corpus", "ai"})
                self.assertEqual(escopos["corpus"], escopos["ai"])
                self.assertIn("maior componente", str(erro.exception))
                self.assertIn("do corpo", str(erro.exception))
                self.assertEqual(
                    {v["kind"] for v in geometria["breaches"]},
                    set(MARCADOR_DA_RECUSA),
                )

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


if __name__ == "__main__":
    unittest.main()
