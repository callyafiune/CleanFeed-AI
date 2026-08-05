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

O INVENTARIO QUE EXISTE e um lote de aquisicao por fonte: um download do dump da Wikipedia,
um download do pacote da Carolina — e as tipologias da Carolina sao particoes desse unico
pacote, nao aquisicoes separadas. Um fixture com cinco lotes por dominio descreveria material
que ninguem tem, e usa-lo para provar viabilidade seria provar sobre um corpus imaginario. Por
isso as duas direcoes abaixo rodam sobre o MESMO fixture de lote-unico-por-celula: com as
chaves v4 ele e viavel, e devolver `domainSource` OU `sourceMaterialBatch` a uniao o torna
inviavel.
"""

from __future__ import annotations

import json
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
    UnsplittableCorpus,
    assert_components_can_fill_five_partitions,
    connected_components,
)

# A menor particao do desenho de cinco (45/5/10/20/20).
MENOR_PARTICAO = 0.05

# As quatro celulas da moldura e o lote de aquisicao de cada uma. Carolina aparece tres vezes
# com o MESMO lote porque um download do pacote e um evento de aquisicao, e as tipologias sao
# particoes dele.
CELULAS: tuple[tuple[str, str], ...] = (
    ("ptwiki_lead", "smb_ptwiki_20220301"),
    ("carolina_judicial_branch", "smb_carolina_2_0"),
    ("carolina_social_media", "smb_carolina_2_0"),
    ("carolina_university_domains", "smb_carolina_2_0"),
)

LINHAS_POR_CELULA = 10


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


def linha_gerada(rec_id: str, semente: str, estrato: str) -> dict:
    """Uma linha GERADA v4, com os eixos que o montador preenche numa lane de geração.

    `humanSeed` nomeia o id de uma linha humana: e o eixo de LINHAGEM DE PAI, e ele une SOMENTE
    quando a linha nomeada esta no mesmo conjunto de registros. E assim que uma linha gerada
    fica no componente do material de que foi semeada; nomeando id ausente, ela fica sozinha.

    `sourceMaterialBatch` e `notApplicable` porque geracao nao adquire material — a tabela de
    estados do esquema so admite esse estado aqui —, e `promptTemplate`, `generatorVersion` e
    `generationBatch` sao proprios de cada linha, senao duas geradas se uniriam por eixo de
    valor e o componente deixaria de ser o declarado.
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
            "promptTemplate": group_axes.known(f"pt_{rec_id}"),
            "generatorVersion": group_axes.known(f"gv_{rec_id}"),
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
    """As quatro celulas, um evento de aquisicao por fonte, cada linha em seu documento."""
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
        """Guarda de estado: os dois eixos grossos estao FORA, e `generationBatch` esta dentro.

        Escrito como igualdade e nao como pertinencia. Uma lista de `assertIn` aceita um
        oitavo eixo acrescentado em silencio, e e justamente acrescentar `domainSource` ou
        `sourceMaterialBatch` que os testes abaixo mostram ser fatal.
        """
        self.assertEqual(
            SPLIT_GROUP_KEYS,
            (
                "author",
                "source",
                "generatorVersion",
                "promptTemplate",
                "generationBatch",
                "nearDuplicate",
                "derivationRoot",
            ),
        )
        self.assertNotIn("domainSource", SPLIT_GROUP_KEYS)
        self.assertNotIn("sourceMaterialBatch", SPLIT_GROUP_KEYS)
        # O eixo diagnostico nunca une: reextrair o mesmo dump nao produz material novo.
        self.assertNotIn("extractionRun", SPLIT_GROUP_KEYS)

    def test_o_fixture_de_lote_unico_e_VIAVEL_sob_v4(self):
        """Quarenta linhas, quarenta componentes: 2,5% cada, e as duas condicoes passam.

        Passar aqui NAO e viabilidade provada — a atribuicao completa e soma de subconjuntos,
        e o preflight declara que nao a decide.
        """
        registros = corpo_de_lote_unico()
        self.assertEqual(len(registros), len(CELULAS) * LINHAS_POR_CELULA)
        # Nao vacuo: o estrato e o lote realmente carregam UM valor por celula, e o lote da
        # Carolina cobre TRES celulas.
        estratos = {r["groups"]["domainSource"]["id"] for r in registros}
        lotes = {r["groups"]["sourceMaterialBatch"]["id"] for r in registros}
        self.assertEqual(len(estratos), 4)
        self.assertEqual(len(lotes), 2)

        quantos, maior = maior_componente(registros)
        self.assertEqual(quantos, len(registros))
        self.assertAlmostEqual(maior, 1 / len(registros), places=6)
        self.assertLess(min_frac(registros), MENOR_PARTICAO)
        assert_components_can_fill_five_partitions(registros)

    def test_devolver_o_ESTRATO_a_uniao_torna_o_mesmo_corpo_INVIAVEL(self):
        """Um componente por celula: 25% cada, e nenhum cabe na particao de 5%.

        A recusa nomeia granularidade e nao tamanho de corpo, porque aumentar o corpo mantendo
        quatro celulas nao muda fracao alguma.
        """
        registros = corpo_de_lote_unico()
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + ("domainSource",),
        ):
            quantos, maior = maior_componente(registros)
            self.assertEqual(quantos, 4)
            self.assertAlmostEqual(maior, 0.25, places=6)
            self.assertGreater(min_frac(registros), MENOR_PARTICAO + 0.02)
            with self.assertRaises(UnsplittableCorpus) as erro:
                assert_components_can_fill_five_partitions(registros)
        self.assertIn("MENOR componente", str(erro.exception))
        self.assertIn("granularidade", str(erro.exception))

    def test_devolver_o_LOTE_a_uniao_torna_o_mesmo_corpo_INVIAVEL(self):
        """Um componente por AQUISICAO: 25% e 75%, e o de 75% nao cabe em particao alguma.

        Esta e a direcao que o inventario real decide: as tres tipologias da Carolina saem do
        mesmo download, entao o lote as funde numa celula unica de 75% — pior que o estrato, e
        nao melhor.

        Este corpo viola AS DUAS condicoes necessarias (o menor componente tambem vale 25%, e
        25% > 5% + 2%), e o preflight relata a PRIMEIRA que checa. Entao o que se afirma aqui
        e qual das duas roda primeiro; o ramo do maior fica isolado em
        `test_recusa_SO_pelo_maior_componente`, que e o unico corpo onde o do menor nao pode
        disparar.
        """
        registros = corpo_de_lote_unico()
        with mock.patch.object(
            assemble_corpus,
            "SPLIT_GROUP_KEYS",
            SPLIT_GROUP_KEYS + ("sourceMaterialBatch",),
        ):
            quantos, maior = maior_componente(registros)
            self.assertEqual(quantos, 2)
            self.assertAlmostEqual(maior, 0.75, places=6)
            with self.assertRaises(UnsplittableCorpus) as erro:
                assert_components_can_fill_five_partitions(registros)
        self.assertIn("maior componente", str(erro.exception))

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

    def test_recusa_corpo_vazio(self):
        with self.assertRaises(UnsplittableCorpus) as erro:
            assert_components_can_fill_five_partitions([])
        self.assertIn("corpo vazio", str(erro.exception))

    def test_a_montagem_de_verdade_chama_esta_guarda_antes_de_carimbar(self):
        """A guarda tem CHAMADOR DE PRODUCAO, e nao so testes.

        `assign_partitions` e o caminho da montagem real. Sem esta assercao, apagar a chamada
        de la deixaria a suite inteira verde e o diagnostico de granularidade existiria apenas
        no benchmark — o operador veria, no lado Python, so "fracao por classe".

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
        self.assertIn("granularidade", str(erro.exception))
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
    """
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
                        linha_gerada(f"a_{marca}_{indice}", semente, estrato_gerado)
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
